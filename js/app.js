/**
 * app.js
 * Wires HyperliquidClient + PriceChart + AlertManager to the DOM.
 * No trading logic, no wallet, no private keys — purely a read-only viewer.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const el = {
    pairName: document.getElementById('pairName'),
    statusPill: document.getElementById('statusPill'),
    statusLabel: document.getElementById('statusLabel'),

    heroPrice: document.getElementById('heroPrice'),
    heroChange: document.getElementById('heroChange'),
    heroChangeAbs: document.getElementById('heroChangeAbs'),
    heroChangePct: document.getElementById('heroChangePct'),

    statLast: document.getElementById('statLast'),
    statChangeAbs: document.getElementById('statChangeAbs'),
    statChangePct: document.getElementById('statChangePct'),
    statHigh: document.getElementById('statHigh'),
    statLow: document.getElementById('statLow'),
    statVolume: document.getElementById('statVolume'),
    statVolumeLabel: document.getElementById('statVolumeLabel'),

    timeframes: document.getElementById('timeframes'),
    chartContainer: document.getElementById('chartContainer'),

    asksList: document.getElementById('asksList'),
    bidsList: document.getElementById('bidsList'),

    bidValue: document.getElementById('bidValue'),
    askValue: document.getElementById('askValue'),
    spreadValue: document.getElementById('spreadValue'),
    spreadPctValue: document.getElementById('spreadPctValue'),

    tradesList: document.getElementById('tradesList'),

    alertForm: document.getElementById('alertForm'),
    alertPrice: document.getElementById('alertPrice'),
    alertDirection: document.getElementById('alertDirection'),
    activeAlertLabel: document.getElementById('activeAlertLabel'),
    clearAlertBtn: document.getElementById('clearAlertBtn'),
    soundToggle: document.getElementById('soundToggle'),

    detailsToggle: document.getElementById('detailsToggle'),
    detailsBody: document.getElementById('detailsBody'),
    dSymbol: document.getElementById('dSymbol'),
    dPrice: document.getElementById('dPrice'),
    dBid: document.getElementById('dBid'),
    dAsk: document.getElementById('dAsk'),
    dSpread: document.getElementById('dSpread'),
    dVolume: document.getElementById('dVolume'),
    dHigh: document.getElementById('dHigh'),
    dLow: document.getElementById('dLow'),
    dUpdate: document.getElementById('dUpdate'),
    dStatus: document.getElementById('dStatus'),

    footerWs: document.getElementById('footerWs'),
    footerUpdate: document.getElementById('footerUpdate'),
    footerLatency: document.getElementById('footerLatency'),

    toast: document.getElementById('alertToast'),
    toastBody: document.getElementById('toastBody'),
    toastClose: document.getElementById('toastClose'),
  };

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  const state = {
    lastPrice: null,
    prevPrice: null,
    prevDayPx: null,   // 24h-ago reference price, from Hyperliquid
    high24h: null,
    low24h: null,
    volumeUsdc24h: null, // dayNtlVlm (USDC-denominated)
    baseVolume24h: null, // sum of candle base-asset volume
    bestBid: null,
    bestAsk: null,
    currentInterval: localStorage.getItem(CONFIG.STORAGE_KEYS.TIMEFRAME) || CONFIG.DEFAULT_TIMEFRAME,
    wsStatus: 'connecting',
  };

  // ---------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------

  function formatPrice(value, opts = {}) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const decimals = value >= 1000 ? 2 : value >= 1 ? 2 : 4;
    return (
      (opts.sign && value > 0 ? '+' : '') +
      '$' +
      value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    );
  }

  function formatSignedPrice(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return sign + '$' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return sign + Math.abs(value).toFixed(2) + '%';
  }

  function formatSize(value, decimals = 5) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return value.toFixed(decimals);
  }

  function formatCompactUsd(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return '$' + (value / 1e3).toFixed(2) + 'K';
    return '$' + value.toFixed(2);
  }

  function formatTime(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return d.toLocaleTimeString('en-US', { hour12: false });
  }

  function dirFromDelta(delta) {
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return 'flat';
  }

  // ---------------------------------------------------------------------
  // Status / connection UI
  // ---------------------------------------------------------------------

  const STATUS_LABELS = {
    connecting: '🟡 CONNECTING',
    live: '🟢 LIVE',
    disconnected: '🔴 DISCONNECTED',
    reconnecting: '🟡 RECONNECTING',
  };

  function setStatus(status) {
    state.wsStatus = status;
    el.statusPill.dataset.state = status;
    el.statusLabel.textContent = STATUS_LABELS[status] || status.toUpperCase();
    el.footerWs.textContent = 'WebSocket: ' + (status === 'live' ? 'Connected' : status[0].toUpperCase() + status.slice(1));
    el.dStatus.textContent = STATUS_LABELS[status] || status;
  }

  // ---------------------------------------------------------------------
  // Price + stats rendering
  // ---------------------------------------------------------------------

  function renderPrice(price, tsMs) {
    state.prevPrice = state.lastPrice;
    state.lastPrice = price;

    el.heroPrice.textContent = formatPrice(price);
    el.statLast.textContent = formatPrice(price);
    el.dPrice.textContent = formatPrice(price);

    if (state.prevPrice !== null && price !== state.prevPrice) {
      const cls = price > state.prevPrice ? 'flash-up' : 'flash-down';
      el.heroPrice.classList.remove('flash-up', 'flash-down');
      // reflow to restart animation
      void el.heroPrice.offsetWidth;
      el.heroPrice.classList.add(cls);
      setTimeout(() => el.heroPrice.classList.remove(cls), CONFIG.FLASH_DURATION_MS);
    }

    renderChange();
    updateFooterTime(tsMs);
    chart.setCurrentPriceLine(price);
    alertManager.checkPrice(price);
  }

  function renderChange() {
    if (state.lastPrice === null || state.prevDayPx === null) return;
    const abs = state.lastPrice - state.prevDayPx;
    const pct = (abs / state.prevDayPx) * 100;
    const dir = dirFromDelta(abs);

    el.heroChangeAbs.textContent = formatSignedPrice(abs);
    el.heroChangePct.textContent = formatPct(pct);
    el.heroChange.dataset.dir = dir;

    el.statChangeAbs.textContent = formatSignedPrice(abs);
    el.statChangeAbs.dataset.dir = dir;
    el.statChangePct.textContent = formatPct(pct);
    el.statChangePct.dataset.dir = dir;
  }

  function renderStaticStats() {
    el.statHigh.textContent = formatPrice(state.high24h);
    el.statLow.textContent = formatPrice(state.low24h);
    el.dHigh.textContent = formatPrice(state.high24h);
    el.dLow.textContent = formatPrice(state.low24h);

    if (state.volumeUsdc24h !== null) {
      el.statVolume.textContent = formatCompactUsd(state.volumeUsdc24h);
      el.statVolumeLabel.textContent = '24H VOLUME (USDC)';
      el.dVolume.textContent = formatCompactUsd(state.volumeUsdc24h) + ' USDC';
    } else if (state.baseVolume24h !== null) {
      el.statVolume.textContent = state.baseVolume24h.toFixed(2) + ' BTC';
      el.statVolumeLabel.textContent = '24H VOLUME (BTC)';
      el.dVolume.textContent = state.baseVolume24h.toFixed(4) + ' BTC';
    }
  }

  function updateFooterTime(tsMs) {
    const t = tsMs || Date.now();
    el.footerUpdate.textContent = 'Last Update: ' + formatTime(t);
    el.dUpdate.textContent = formatTime(t);
  }

  // ---------------------------------------------------------------------
  // Order book rendering
  // ---------------------------------------------------------------------

  function renderBook({ bids, asks }) {
    const N = CONFIG.ORDER_BOOK_LEVELS;
    // Bids arrive best-first (highest price first) — keep as-is so the best
    // bid sits at the top of the bids block, nearest the spread.
    const topBids = bids.slice(0, N);
    // Asks arrive best-first (lowest price first) — reverse so the worst
    // (highest) ask is at the top and the best ask sits at the bottom,
    // nearest the spread, matching a standard order-book layout.
    const topAsks = asks.slice(0, N).slice().reverse();

    el.asksList.innerHTML = topAsks
      .map((lvl) => rowHtml(lvl, 'ask'))
      .join('');
    el.bidsList.innerHTML = topBids
      .map((lvl) => rowHtml(lvl, 'bid'))
      .join('');

    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    state.bestBid = bestBid;
    state.bestAsk = bestAsk;

    el.bidValue.textContent = formatPrice(bestBid);
    el.askValue.textContent = formatPrice(bestAsk);
    el.dBid.textContent = formatPrice(bestBid);
    el.dAsk.textContent = formatPrice(bestAsk);

    if (bestBid !== null && bestAsk !== null) {
      const spread = bestAsk - bestBid;
      const spreadPct = (spread / bestAsk) * 100;
      el.spreadValue.textContent = formatSignedPrice(spread).replace('+', '');
      el.spreadPctValue.textContent = spreadPct.toFixed(3) + '%';
      el.dSpread.textContent = formatSignedPrice(spread).replace('+', '') + ' (' + spreadPct.toFixed(3) + '%)';
    }
  }

  function rowHtml(lvl, side) {
    return (
      '<div class="ob-row ob-row--' +
      side +
      '"><span>' +
      formatPrice(lvl.price) +
      '</span><span>' +
      formatSize(lvl.size) +
      '</span></div>'
    );
  }

  // ---------------------------------------------------------------------
  // Trades rendering
  // ---------------------------------------------------------------------

  function renderTrades(trades) {
    const rows = trades
      .slice(-CONFIG.RECENT_TRADES_MAX)
      .reverse()
      .map(
        (t) =>
          '<div class="trade-row trade-row--' +
          t.side +
          '"><span class="trade-row__price">' +
          formatPrice(t.price) +
          '</span><span>' +
          formatSize(t.size) +
          '</span><span>' +
          formatTime(t.time) +
          '</span></div>'
      )
      .join('');
    el.tradesList.innerHTML = rows + el.tradesList.innerHTML;

    // cap DOM size
    while (el.tradesList.children.length > CONFIG.RECENT_TRADES_MAX) {
      el.tradesList.removeChild(el.tradesList.lastChild);
    }
  }

  // ---------------------------------------------------------------------
  // Timeframe buttons
  // ---------------------------------------------------------------------

  function buildTimeframeButtons() {
    el.timeframes.innerHTML = '';
    CONFIG.TIMEFRAMES.forEach((tf) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'timeframe-btn' + (tf.key === state.currentInterval ? ' active' : '');
      btn.textContent = tf.label;
      btn.dataset.key = tf.key;
      btn.addEventListener('click', () => selectTimeframe(tf.key));
      el.timeframes.appendChild(btn);
    });
  }

  async function selectTimeframe(key) {
    if (key === state.currentInterval) return;
    state.currentInterval = key;
    localStorage.setItem(CONFIG.STORAGE_KEYS.TIMEFRAME, key);
    [...el.timeframes.children].forEach((b) => b.classList.toggle('active', b.dataset.key === key));

    client.setCandleInterval(key);
    await loadHistoryForInterval(key);
  }

  async function loadHistoryForInterval(interval) {
    try {
      const tf = CONFIG.TIMEFRAMES.find((t) => t.key === interval);
      const end = Date.now();
      const start = end - tf.ms * CONFIG.CANDLE_LOOKBACK_BARS;
      const candles = await client.fetchCandles(interval, start, end);
      chart.setHistory(candles);
      if (state.lastPrice !== null) chart.setCurrentPriceLine(state.lastPrice);
    } catch (err) {
      console.error('Failed to load candle history:', err);
    }
  }

  // ---------------------------------------------------------------------
  // Alerts UI
  // ---------------------------------------------------------------------

  function renderAlertLabel() {
    if (alertManager.alert) {
      const { price, direction } = alertManager.alert;
      el.activeAlertLabel.textContent = `Alert: ${direction === 'above' ? 'ABOVE' : 'BELOW'} ${formatPrice(price)}`;
      el.clearAlertBtn.hidden = false;
    } else {
      el.activeAlertLabel.textContent = 'No alert set';
      el.clearAlertBtn.hidden = true;
    }
  }

  function showToast(message) {
    el.toastBody.textContent = message;
    el.toast.hidden = false;
  }

  el.toastClose.addEventListener('click', () => {
    el.toast.hidden = true;
  });

  el.alertForm.addEventListener('submit', (e) => {
    e.preventDefault();
    alertManager.unlockAudio(); // user gesture — safe to unlock audio here too
    const price = parseFloat(el.alertPrice.value);
    const direction = el.alertDirection.value;
    if (alertManager.setAlert(price, direction)) {
      renderAlertLabel();
      el.alertPrice.value = '';
    }
  });

  el.clearAlertBtn.addEventListener('click', () => {
    alertManager.clearAlert();
    renderAlertLabel();
  });

  el.soundToggle.addEventListener('change', () => {
    alertManager.unlockAudio();
    alertManager.setSound(el.soundToggle.checked);
  });

  // ---------------------------------------------------------------------
  // Details collapsible
  // ---------------------------------------------------------------------

  el.detailsToggle.addEventListener('click', () => {
    const expanded = el.detailsToggle.getAttribute('aria-expanded') === 'true';
    el.detailsToggle.setAttribute('aria-expanded', String(!expanded));
    el.detailsBody.hidden = expanded;
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  const chart = new PriceChart(el.chartContainer);

  const alertManager = new AlertManager(({ price, direction, target }) => {
    showToast(`BTC/USDC has reached ${formatPrice(price)} (${direction === 'above' ? 'above' : 'below'} ${formatPrice(target)})`);
    renderAlertLabel();
  });
  el.soundToggle.checked = alertManager.soundOn;
  renderAlertLabel();

  const client = new HyperliquidClient({
    onStatusChange: setStatus,
    onMarketResolved: ({ displayName }) => {
      const [base, quote] = displayName.split('/');
      el.pairName.textContent = `BTC / ${quote || 'USDC'}`;
      el.dSymbol.textContent = displayName + ` (${client.coinId})`;
    },
    onMids: ({ price, time }) => renderPrice(price, time),
    onBook: (book) => {
      renderBook(book);
      updateFooterTime(book.time);
    },
    onTrades: (trades) => renderTrades(trades),
    onCandle: (candle) => chart.updateBar(candle),
    onLatency: (ms) => {
      el.footerLatency.hidden = false;
      el.footerLatency.textContent = 'Latency: ' + ms + ' ms';
    },
    onError: (msg) => console.warn('[Hyperliquid]', msg),
  });

  async function init() {
    buildTimeframeButtons();
    setStatus('connecting');

    try {
      await client.resolveMarket();
    } catch (err) {
      console.error(err);
      setStatus('disconnected');
      el.heroPrice.textContent = 'Unavailable';
      return;
    }

    // Load initial REST snapshot (24h stats + candle history) before the
    // WebSocket takes over for live updates.
    try {
      const [stats, rolling, candles] = await Promise.all([
        client.fetchInitialStats(),
        client.fetchRolling24h(),
        (async () => {
          const tf = CONFIG.TIMEFRAMES.find((t) => t.key === state.currentInterval);
          const end = Date.now();
          const start = end - tf.ms * CONFIG.CANDLE_LOOKBACK_BARS;
          return client.fetchCandles(state.currentInterval, start, end);
        })(),
      ]);

      state.prevDayPx = stats.prevDayPx;
      state.volumeUsdc24h = stats.dayNtlVlm;
      if (rolling) {
        state.high24h = rolling.high;
        state.low24h = rolling.low;
        state.baseVolume24h = state.volumeUsdc24h === null ? rolling.baseVolume : null;
      }

      const initialPrice = stats.markPx ?? stats.midPx;
      if (initialPrice !== null) renderPrice(initialPrice, Date.now());
      renderStaticStats();
      chart.setHistory(candles);
    } catch (err) {
      console.error('Failed to load initial market data:', err);
    }

    client.connect();
  }

  init();
})();
