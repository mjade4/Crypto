/**
 * hyperliquid.js
 * All communication with Hyperliquid's public Info API (REST) and
 * WebSocket API lives here. Nothing in this file ever signs a request,
 * places an order, or touches a wallet — it only reads public market data.
 *
 * Public surface (window.Hyperliquid):
 *   resolveMarket()                -> Promise<{ coin, displaySymbol }>
 *   fetchCandles(coin, interval, startMs, endMs) -> Promise<Candle[]>
 *   connect(coin)                  -> starts the live WebSocket feed
 *   disconnect()
 *   setActiveInterval(interval)    -> re-subscribes candle feed on timeframe change
 *   on(event, handler)             -> 'status' | 'price' | 'candle' | 'error'
 */
const Hyperliquid = (() => {
  const listeners = { status: [], price: [], candle: [], error: [] };
  let ws = null;
  let wsConnectAttempted = false;
  let currentCoin = null;
  let currentInterval = null;
  let pingTimer = null;
  let staleWatchTimer = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let lastMessageAt = 0;
  let status = 'disconnected'; // connecting | live | reconnecting | disconnected

  function emit(event, payload) {
    for (const fn of listeners[event] || []) {
      try { fn(payload); } catch (e) { console.error(`[Hyperliquid] listener error for ${event}`, e); }
    }
  }

  function on(event, handler) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    emit('status', status);
  }

  // ---------------------------------------------------------------------
  // REST: /info
  // ---------------------------------------------------------------------
  async function infoRequest(body) {
    const res = await fetch(CONFIG.REST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Hyperliquid /info ${body.type} failed: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Determines the exact Hyperliquid spot market identifier for BTC/USDC
   * by reading the live spotMeta universe rather than assuming an index.
   * On HyperCore, the pair displayed as "BTC/USDC" in Hyperliquid's own UI
   * is backed by the token "UBTC" quoted in USDC.
   */
  async function resolveMarket() {
    const meta = await infoRequest({ type: 'spotMeta' });
    if (!meta || !Array.isArray(meta.tokens) || !Array.isArray(meta.universe)) {
      throw new Error('Unexpected spotMeta response shape from Hyperliquid');
    }

    const baseToken = meta.tokens.find(
      (t) => (t.name || '').toUpperCase() === CONFIG.BASE_TOKEN_NAME.toUpperCase()
    );
    const quoteToken = meta.tokens.find(
      (t) => (t.name || '').toUpperCase() === CONFIG.QUOTE_TOKEN_NAME.toUpperCase()
    );

    if (!baseToken || !quoteToken) {
      throw new Error('Could not locate UBTC or USDC token in Hyperliquid spotMeta');
    }

    const pair = meta.universe.find(
      (u) => Array.isArray(u.tokens) && u.tokens[0] === baseToken.index && u.tokens[1] === quoteToken.index
    );

    if (!pair) {
      throw new Error('Could not locate UBTC/USDC pair in Hyperliquid spotMeta universe');
    }

    // PURR/USDC is the sole pair addressed by name; every other spot pair,
    // including this one, is addressed as "@<universe index>".
    const coin = `@${pair.index}`;
    return { coin, displaySymbol: CONFIG.DISPLAY_SYMBOL, rawPairName: pair.name };
  }

  /**
   * Pulls OHLC candles for a coin/interval over [startMs, endMs].
   * Used for: seeding the chart on load/timeframe-switch, and computing
   * the rolling 24H HIGH / 24H LOW stat.
   */
  async function fetchCandles(coin, interval, startMs, endMs) {
    const data = await infoRequest({
      type: 'candleSnapshot',
      req: { coin, interval, startTime: startMs, endTime: endMs },
    });
    if (!Array.isArray(data)) return [];
    return data.map((c) => ({
      time: Math.floor(c.t / 1000), // seconds, for the chart library
      open: Number(c.o),
      high: Number(c.h),
      low: Number(c.l),
      close: Number(c.c),
      volume: Number(c.v),
    }));
  }

  // ---------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------
  function clearTimers() {
    if (pingTimer) clearInterval(pingTimer);
    if (staleWatchTimer) clearInterval(staleWatchTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    pingTimer = staleWatchTimer = reconnectTimer = null;
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function subscribeAll() {
    if (!currentCoin) return;
    send({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin: currentCoin } });
    if (currentInterval) {
      send({ method: 'subscribe', subscription: { type: 'candle', coin: currentCoin, interval: currentInterval } });
    }
  }

  function unsubscribeCandle(interval) {
    if (!currentCoin || !interval) return;
    send({ method: 'unsubscribe', subscription: { type: 'candle', coin: currentCoin, interval } });
  }

  function setActiveInterval(interval) {
    if (interval === currentInterval) return;
    const prev = currentInterval;
    currentInterval = interval;
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (prev) unsubscribeCandle(prev);
      send({ method: 'subscribe', subscription: { type: 'candle', coin: currentCoin, interval } });
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return; // already scheduled
    setStatus('reconnecting');
    const backoff = Math.min(
      CONFIG.WS_RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
      CONFIG.WS_RECONNECT_MAX_MS
    );
    const jitter = Math.floor(Math.random() * CONFIG.WS_RECONNECT_JITTER_MS);
    const delay = backoff + jitter;
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  function handleMessage(raw) {
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(raw.data);
    } catch (e) {
      return; // ignore malformed frames rather than crashing the app
    }

    const channel = msg.channel;

    if (channel === 'pong' || channel === 'subscriptionResponse') {
      // Any traffic counts as evidence of a live connection.
      if (status !== 'live') setStatus('live');
      return;
    }

    if (channel === 'activeAssetCtx' || channel === 'activeSpotAssetCtx') {
      setStatus('live');
      const data = msg.data || {};
      const ctx = data.ctx || {};
      emit('price', {
        coin: data.coin,
        markPx: ctx.markPx != null ? Number(ctx.markPx) : null,
        midPx: ctx.midPx != null ? Number(ctx.midPx) : null,
        prevDayPx: ctx.prevDayPx != null ? Number(ctx.prevDayPx) : null,
        dayNtlVlm: ctx.dayNtlVlm != null ? Number(ctx.dayNtlVlm) : null,
        dayBaseVlm: ctx.dayBaseVlm != null ? Number(ctx.dayBaseVlm) : null,
        receivedAt: lastMessageAt,
      });
      return;
    }

    if (channel === 'candle') {
      setStatus('live');
      const c = msg.data;
      if (!c) return;
      emit('candle', {
        time: Math.floor(c.t / 1000),
        open: Number(c.o),
        high: Number(c.h),
        low: Number(c.l),
        close: Number(c.c),
        volume: Number(c.v),
        interval: c.i,
      });
      return;
    }

    if (channel === 'error') {
      emit('error', msg.data || 'Hyperliquid WebSocket reported an error');
    }
  }

  function openSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return; // never allow more than one simultaneous connection
    }
    wsConnectAttempted = true;
    setStatus(reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      ws = new WebSocket(CONFIG.WS_URL);
    } catch (e) {
      emit('error', 'Unable to open Hyperliquid WebSocket');
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      reconnectAttempts = 0;
      lastMessageAt = Date.now();
      subscribeAll();

      pingTimer = setInterval(() => send({ method: 'ping' }), CONFIG.WS_PING_INTERVAL_MS);

      staleWatchTimer = setInterval(() => {
        if (Date.now() - lastMessageAt > CONFIG.WS_STALE_AFTER_MS) {
          // No data for too long — don't keep claiming LIVE. Force a clean
          // reconnect so subscriptions are guaranteed fresh.
          setStatus('disconnected');
          try { ws.close(); } catch (e) { /* no-op */ }
        }
      }, 5000);
    });

    ws.addEventListener('message', handleMessage);

    ws.addEventListener('close', () => {
      clearTimers();
      setStatus('disconnected');
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      emit('error', 'Hyperliquid WebSocket connection error');
      try { ws.close(); } catch (e) { /* the close handler drives reconnection */ }
    });
  }

  function connect(coin) {
    currentCoin = coin;
    if (!currentInterval) currentInterval = CONFIG.TIMEFRAMES[0].interval;
    reconnectAttempts = 0;
    openSocket();
  }

  function disconnect() {
    clearTimers();
    if (ws) {
      ws.removeEventListener('message', handleMessage);
      try { ws.close(); } catch (e) { /* no-op */ }
    }
    ws = null;
    setStatus('disconnected');
  }

  return {
    on,
    resolveMarket,
    fetchCandles,
    connect,
    disconnect,
    setActiveInterval,
    getStatus: () => status,
  };
})();
