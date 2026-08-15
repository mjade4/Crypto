/**
 * hyperliquid.js
 *
 * Encapsulates all communication with Hyperliquid's public market-data API.
 * Nothing outside this file needs to know about REST payload shapes or the
 * WebSocket subscription protocol.
 *
 * Data source: Hyperliquid (https://hyperliquid.gitbook.io/hyperliquid-docs)
 *   - Info endpoint (REST):      POST https://api.hyperliquid.xyz/info
 *   - WebSocket endpoint:        wss://api.hyperliquid.xyz/ws
 *
 * This client is strictly READ-ONLY. It never signs anything, never asks
 * for a wallet, private key, or seed phrase, and never places or manages
 * orders.
 */

class HyperliquidClient {
  /**
   * @param {Object} handlers
   * @param {(status: 'connecting'|'live'|'disconnected'|'reconnecting') => void} handlers.onStatusChange
   * @param {(tick: {price: number, time: number}) => void} handlers.onMids
   * @param {(book: {bids: Array, asks: Array, time: number}) => void} handlers.onBook
   * @param {(trades: Array) => void} handlers.onTrades
   * @param {(candle: Object) => void} handlers.onCandle
   * @param {(market: {coinId: string, displayName: string, baseName: string}) => void} handlers.onMarketResolved
   * @param {(message: string) => void} handlers.onError
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.ws = null;
    this.coinId = null; // e.g. "@142" — the identifier Hyperliquid expects on the wire
    this.displayName = CONFIG.FALLBACK_DISPLAY_NAME;
    this.baseName = 'UBTC';
    this.currentInterval = CONFIG.DEFAULT_TIMEFRAME;

    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._explicitClose = false;
    this._connectedOnce = false;
    this._lastMessageAt = 0;
    this._pingInterval = null;
    this._stabilityTimer = null;
    this._lastPingSentAt = null;
  }

  // ---------------------------------------------------------------------
  // Market resolution
  // ---------------------------------------------------------------------

  /**
   * Determine the exact Hyperliquid spot market identifier for BTC/USDC.
   * Hyperliquid's own docs state: "coin should be PURR/USDC for PURR, and
   * @{index} ... where index is the index of the spot pair in the universe
   * field of the spotMeta response." BTC/USDC (as shown on the Hyperliquid
   * UI) corresponds to the HyperCore token UBTC paired with USDC. We look
   * this up dynamically instead of assuming a fixed index, because the
   * universe can be reordered as new markets are listed.
   */
  async resolveMarket() {
    const meta = await this._postInfo({ type: 'spotMeta' });
    if (!meta || !Array.isArray(meta.tokens) || !Array.isArray(meta.universe)) {
      throw new Error('Unexpected spotMeta response shape from Hyperliquid.');
    }

    let baseToken = null;
    for (const candidate of CONFIG.BASE_TOKEN_CANDIDATES) {
      baseToken = meta.tokens.find(
        (t) => typeof t.name === 'string' && t.name.toUpperCase() === candidate
      );
      if (baseToken) break;
    }
    if (!baseToken) {
      throw new Error('Could not find a BTC-backed token in Hyperliquid spotMeta.tokens.');
    }

    const pair = meta.universe.find((u) => {
      if (!Array.isArray(u.tokens) || u.tokens.length !== 2) return false;
      const [base, quote] = u.tokens;
      return base === baseToken.index && quote === CONFIG.QUOTE_TOKEN_INDEX;
    });
    if (!pair) {
      throw new Error('Could not find a spot universe entry pairing the BTC token with USDC.');
    }

    // Per docs, PURR/USDC is addressed by name; every other pair is
    // addressed as "@{universe index}".
    const coinId = pair.name === 'PURR/USDC' ? pair.name : `@${pair.index}`;

    this.coinId = coinId;
    this.baseName = baseToken.name;
    this.displayName = pair.name || `${baseToken.name}/USDC`;

    this.handlers.onMarketResolved?.({
      coinId: this.coinId,
      displayName: this.displayName,
      baseName: this.baseName,
    });

    return this.coinId;
  }

  // ---------------------------------------------------------------------
  // REST: initial snapshot data (used once at load, then WS takes over)
  // ---------------------------------------------------------------------

  async fetchInitialStats() {
    const [spotMeta, assetCtxs] = await this._postInfo({ type: 'spotMetaAndAssetCtxs' });
    if (!Array.isArray(assetCtxs)) throw new Error('Unexpected spotMetaAndAssetCtxs response.');

    const pairIndex = spotMeta.universe.findIndex((u) => {
      const coinId = u.name === 'PURR/USDC' ? u.name : `@${u.index}`;
      return coinId === this.coinId;
    });
    const ctx = assetCtxs[pairIndex];
    if (!ctx) throw new Error('Could not locate asset context for the resolved market.');

    return {
      markPx: this._toNumber(ctx.markPx),
      midPx: this._toNumber(ctx.midPx),
      prevDayPx: this._toNumber(ctx.prevDayPx),
      dayNtlVlm: this._toNumber(ctx.dayNtlVlm), // USDC-denominated 24h volume
    };
  }

  /**
   * Rolling 24h high/low/base-volume, derived from the most recent 24
   * hourly candles (Hyperliquid's asset-context response has no high/low
   * fields, so we compute this from real candle data rather than inventing
   * it).
   */
  async fetchRolling24h() {
    const end = Date.now();
    const start = end - CONFIG.ROLLING_24H_BARS * 60 * 60 * 1000;
    const candles = await this.fetchCandles(CONFIG.ROLLING_24H_INTERVAL, start, end);
    if (!candles.length) return null;

    let high = -Infinity;
    let low = Infinity;
    let baseVolume = 0;
    for (const c of candles) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      baseVolume += c.volume;
    }
    return { high, low, baseVolume };
  }

  /**
   * Historical OHLCV candles via the candleSnapshot info method.
   * Returns normalized {time, open, high, low, close, volume} objects,
   * time in seconds (for charting-library compatibility).
   */
  async fetchCandles(interval, startTime, endTime) {
    const raw = await this._postInfo({
      type: 'candleSnapshot',
      req: { coin: this.coinId, interval, startTime, endTime },
    });
    if (!Array.isArray(raw)) return [];
    return raw
      .map((c) => this._normalizeCandle(c))
      .filter((c) => c !== null)
      .sort((a, b) => a.time - b.time);
  }

  _normalizeCandle(c) {
    if (!c || typeof c.t !== 'number') return null;
    const open = this._toNumber(c.o);
    const high = this._toNumber(c.h);
    const low = this._toNumber(c.l);
    const close = this._toNumber(c.c);
    const volume = this._toNumber(c.v);
    if ([open, high, low, close].some((v) => v === null || Number.isNaN(v))) return null;
    return { time: Math.floor(c.t / 1000), open, high, low, close, volume: volume || 0 };
  }

  // ---------------------------------------------------------------------
  // WebSocket lifecycle
  // ---------------------------------------------------------------------

  connect() {
    if (!this.coinId) {
      this.handlers.onError?.('Cannot connect: market has not been resolved yet.');
      return;
    }
    this._explicitClose = false;
    this._openSocket();
  }

  disconnect() {
    this._explicitClose = true;
    this._clearReconnectTimer();
    this._clearPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {
        /* no-op */
      }
      this.ws = null;
    }
  }

  setCandleInterval(interval) {
    const isValid = CONFIG.TIMEFRAMES.some((tf) => tf.key === interval);
    if (!isValid) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._unsubscribe({ type: 'candle', coin: this.coinId, interval: this.currentInterval });
      this.currentInterval = interval;
      this._subscribe({ type: 'candle', coin: this.coinId, interval: this.currentInterval });
    } else {
      this.currentInterval = interval;
    }
  }

  _openSocket() {
    this._setStatus(this._connectedOnce ? 'reconnecting' : 'connecting');

    let socket;
    try {
      socket = new WebSocket(CONFIG.WS_URL);
    } catch (err) {
      this.handlers.onError?.('Failed to open WebSocket: ' + err.message);
      this._scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.addEventListener('open', () => {
      this._reconnectAttempt = 0;
      this._connectedOnce = true;
      this._lastMessageAt = Date.now();
      this._restoreSubscriptions();
      this._startPing();
      // Consider the connection "LIVE" once we've successfully subscribed;
      // status flips to live on the first valid data message (see
      // _handleMessage) so we never claim LIVE before real data arrives.
    });

    socket.addEventListener('message', (event) => this._handleMessage(event));

    socket.addEventListener('close', () => {
      this._clearPing();
      if (!this._explicitClose) {
        this._setStatus('disconnected');
        this._scheduleReconnect();
      }
    });

    socket.addEventListener('error', () => {
      // The subsequent 'close' event drives reconnect logic; this just
      // surfaces a message for diagnostics.
      this.handlers.onError?.('WebSocket error.');
    });
  }

  _restoreSubscriptions() {
    this._subscribe({ type: 'l2Book', coin: this.coinId });
    this._subscribe({ type: 'trades', coin: this.coinId });
    this._subscribe({ type: 'candle', coin: this.coinId, interval: this.currentInterval });
  }

  _subscribe(subscription) {
    this._send({ method: 'subscribe', subscription });
  }

  _unsubscribe(subscription) {
    this._send({ method: 'unsubscribe', subscription });
  }

  _send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  _startPing() {
    this._clearPing();
    // Hyperliquid recommends clients keep connections alive; a lightweight
    // ping method call also lets us detect silently-dead sockets.
    this._pingInterval = setInterval(() => {
      this._lastPingSentAt = Date.now();
      this._send({ method: 'ping' });
      const idleMs = Date.now() - this._lastMessageAt;
      if (idleMs > 45000 && this.ws) {
        try {
          this.ws.close();
        } catch (_) {
          /* no-op */
        }
      }
    }, 15000);
  }

  _clearPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  _scheduleReconnect() {
    if (this._explicitClose) return;
    this._clearReconnectTimer();
    const delays = CONFIG.RECONNECT_DELAYS_MS;
    const delay = delays[Math.min(this._reconnectAttempt, delays.length - 1)];
    this._reconnectAttempt += 1;
    this._setStatus('reconnecting');
    this._reconnectTimer = setTimeout(() => {
      if (!this._explicitClose) this._openSocket();
    }, delay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _setStatus(status) {
    this.handlers.onStatusChange?.(status);
  }

  // ---------------------------------------------------------------------
  // Message handling + validation
  // ---------------------------------------------------------------------

  _handleMessage(event) {
    this._lastMessageAt = Date.now();

    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (_) {
      return; // malformed JSON — ignore, never crash
    }
    if (!msg || typeof msg !== 'object' || typeof msg.channel !== 'string') return;

    switch (msg.channel) {
      case 'subscriptionResponse':
        // Acknowledgement only; once we're subscribed and start receiving
        // real channel data below we flip to LIVE.
        return;

      case 'pong':
        if (this._lastPingSentAt) {
          const rtt = Date.now() - this._lastPingSentAt;
          this._lastPingSentAt = null;
          if (rtt >= 0 && rtt < 30000) this.handlers.onLatency?.(rtt);
        }
        return;

      case 'allMids':
        this._handleMids(msg.data);
        return;

      case 'l2Book':
        this._handleBook(msg.data);
        return;

      case 'trades':
        this._handleTrades(msg.data);
        return;

      case 'candle':
        this._handleCandle(msg.data);
        return;

      case 'error':
        this.handlers.onError?.(typeof msg.data === 'string' ? msg.data : 'Hyperliquid WS error.');
        return;

      default:
        return; // unhandled/irrelevant channel — ignore safely
    }
  }

  _handleMids(data) {
    if (!data || typeof data.mids !== 'object') return;
    const raw = data.mids[this.coinId];
    const price = this._toNumber(raw);
    if (price === null || !Number.isFinite(price) || price <= 0) return;
    this._setStatus('live');
    this.handlers.onMids?.({ price, time: Date.now() });
  }

  _handleBook(data) {
    if (!data || !Array.isArray(data.levels) || data.levels.length !== 2) return;
    const [bidLevels, askLevels] = data.levels;
    if (!Array.isArray(bidLevels) || !Array.isArray(askLevels)) return;

    const normalize = (levels) =>
      levels
        .map((lvl) => ({
          price: this._toNumber(lvl.px),
          size: this._toNumber(lvl.sz),
        }))
        .filter((lvl) => lvl.price !== null && lvl.size !== null);

    const bids = normalize(bidLevels);
    const asks = normalize(askLevels);
    if (!bids.length && !asks.length) return;

    this._setStatus('live');
    this.handlers.onBook?.({
      bids,
      asks,
      time: typeof data.time === 'number' ? data.time : Date.now(),
    });
  }

  _handleTrades(data) {
    if (!Array.isArray(data) || !data.length) return;
    const trades = data
      .map((t) => ({
        price: this._toNumber(t.px),
        size: this._toNumber(t.sz),
        side: t.side === 'B' ? 'buy' : t.side === 'A' ? 'sell' : null,
        time: typeof t.time === 'number' ? t.time : null,
      }))
      .filter((t) => t.price !== null && t.size !== null && t.time !== null);
    if (!trades.length) return;

    this._setStatus('live');
    this.handlers.onTrades?.(trades);
  }

  _handleCandle(data) {
    const candle = this._normalizeCandle(data);
    if (!candle) return;
    // Only forward candles for the interval we're currently displaying.
    if (data.i !== this.currentInterval) return;
    this._setStatus('live');
    this.handlers.onCandle?.(candle);
  }

  // ---------------------------------------------------------------------
  // REST helper
  // ---------------------------------------------------------------------

  async _postInfo(body) {
    const res = await fetch(CONFIG.INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Hyperliquid info request failed: HTTP ${res.status}`);
    }
    return res.json();
  }

  _toNumber(v) {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
}
