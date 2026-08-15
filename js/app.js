/**
 * app.js
 * Ties Hyperliquid data, the chart, and the alert module to the DOM.
 * This is the only file that touches document.* directly.
 */
(() => {
  'use strict';

  const els = {
    symbolBadge: document.getElementById('symbol-badge'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    price: document.getElementById('price'),
    changeAbs: document.getElementById('change-abs'),
    changePct: document.getElementById('change-pct'),
    high: document.getElementById('stat-high'),
    low: document.getElementById('stat-low'),
    volume: document.getElementById('stat-volume'),
    changeAbsStat: document.getElementById('stat-change-abs'),
    changePctStat: document.getElementById('stat-change-pct'),
    lastUpdated: document.getElementById('last-updated'),
    chartContainer: document.getElementById('chart'),
    timeframeBar: document.getElementById('timeframe-bar'),
    errorBanner: document.getElementById('error-banner'),
    errorBannerText: document.getElementById('error-banner-text'),
    retryButton: document.getElementById('retry-button'),
    alertForm: document.getElementById('alert-form'),
    alertPriceInput: document.getElementById('alert-price'),
    alertCondition: document.getElementById('alert-condition'),
    alertActive: document.getElementById('alert-active'),
    alertActiveText: document.getElementById('alert-active-text'),
    alertToggle: document.getElementById('alert-toggle'),
    alertDelete: document.getElementById('alert-delete'),
    alertFired: document.getElementById('alert-fired'),
    alertFiredText: document.getElementById('alert-fired-text'),
    alertFiredClose: document.getElementById('alert-fired-close'),
  };

  const state = {
    coin: null,
    interval: null,
    timeframeId: CONFIG.DEFAULT_TIMEFRAME,
    lastPrice: null,
    prevDayPx: null,
    dayHigh: null,
    dayLow: null,
    dayVolume: null,
    lastMessageAt: null,
    statsTimer: null,
    tickTimer: null,
  };

  // ------------------------------------------------------------------
  // Formatting helpers
  // ------------------------------------------------------------------
  function decimalsFor(value) {
    if (value == null || !isFinite(value)) return 2;
    return value >= 1 ? 2 : 6;
  }

  function formatUsd(value, opts = {}) {
    if (value == null || !isFinite(value)) return '—';
    const decimals = opts.decimals ?? decimalsFor(value);
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatSigned(value, decimals) {
    if (value == null || !isFinite(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '\u2212' : '';
    return `${sign}${formatUsd(Math.abs(value), { decimals })}`;
  }

  function formatPct(value) {
    if (value == null || !isFinite(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '\u2212' : '';
    return `${sign}${Math.abs(value).toFixed(2)}%`;
  }

  function formatVolume(value) {
    if (value == null || !isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
    return `$${formatUsd(value)}`;
  }

  function setMovementClass(el, delta) {
    el.classList.remove('is-up', 'is-down', 'is-flat');
    if (delta > 0) el.classList.add('is-up');
    else if (delta < 0) el.classList.add('is-down');
    else el.classList.add('is-flat');
  }

  // ------------------------------------------------------------------
  // Connection status
  // ------------------------------------------------------------------
  const STATUS_COPY = {
    connecting: { text: 'CONNECTING', cls: 'is-connecting' },
    live: { text: 'LIVE', cls: 'is-live' },
    reconnecting: { text: 'RECONNECTING', cls: 'is-connecting' },
    disconnected: { text: 'DISCONNECTED', cls: 'is-disconnected' },
  };

  function renderStatus(status) {
    const copy = STATUS_COPY[status] || STATUS_COPY.disconnected;
    els.statusDot.className = `status-dot ${copy.cls}`;
    els.statusText.textContent = copy.text;
    els.statusText.className = `status-text ${copy.cls}`;
  }

  // ------------------------------------------------------------------
  // Price + stats rendering
  // ------------------------------------------------------------------
  function renderPrice(price, prevPrice) {
    const decimals = decimalsFor(price);
    els.price.textContent = `$${formatUsd(price, { decimals })}`;
    if (prevPrice != null && price !== prevPrice) {
      const el = els.price;
      el.classList.remove('flash-up', 'flash-down');
      // Force reflow so the animation can restart on rapid consecutive ticks.
      void el.offsetWidth;
      el.classList.add(price > prevPrice ? 'flash-up' : 'flash-down');
      setTimeout(() => el.classList.remove('flash-up', 'flash-down'), CONFIG.PRICE_FLASH_MS);
    }
  }

  function renderChange() {
    if (state.lastPrice == null || state.prevDayPx == null) return;
    const abs = state.lastPrice - state.prevDayPx;
    const pct = (abs / state.prevDayPx) * 100;

    els.changeAbs.textContent = formatSigned(abs, decimalsFor(state.lastPrice));
    els.changePct.textContent = formatPct(pct);
    setMovementClass(els.changeAbs, abs);
    setMovementClass(els.changePct, abs);

    els.changeAbsStat.textContent = formatSigned(abs, decimalsFor(state.lastPrice));
    els.changePctStat.textContent = formatPct(pct);
    setMovementClass(els.changeAbsStat, abs);
    setMovementClass(els.changePctStat, abs);
  }

  function renderStats() {
    els.high.textContent = state.dayHigh != null ? `$${formatUsd(state.dayHigh, { decimals: decimalsFor(state.dayHigh) })}` : '—';
    els.low.textContent = state.dayLow != null ? `$${formatUsd(state.dayLow, { decimals: decimalsFor(state.dayLow) })}` : '—';
    els.volume.textContent = formatVolume(state.dayVolume);
  }

  function renderLastUpdated() {
    if (!state.lastMessageAt) {
      els.lastUpdated.textContent = 'Waiting for data…';
      els.lastUpdated.classList.remove('is-stale');
      return;
    }
    const seconds = Math.max(0, Math.round((Date.now() - state.lastMessageAt) / 1000));
    const stale = Date.now() - state.lastMessageAt > CONFIG.STALE_LABEL_AFTER_MS;
    els.lastUpdated.classList.toggle('is-stale', stale);
    if (stale) {
      els.lastUpdated.textContent = `Data stale — last update ${seconds}s ago`;
    } else if (seconds < 2) {
      els.lastUpdated.textContent = 'Updated just now';
    } else {
      els.lastUpdated.textContent = `Updated ${seconds}s ago`;
    }
  }

  // ------------------------------------------------------------------
  // Error banner
  // ------------------------------------------------------------------
  function showError(message) {
    els.errorBannerText.textContent = message;
    els.errorBanner.hidden = false;
  }

  function hideError() {
    els.errorBanner.hidden = true;
  }

  // ------------------------------------------------------------------
  // Timeframes
  // ------------------------------------------------------------------
  function getTimeframe(id) {
    return CONFIG.TIMEFRAMES.find((tf) => tf.id === id) || CONFIG.TIMEFRAMES[0];
  }

  function renderTimeframeButtons() {
    [...els.timeframeBar.querySelectorAll('button')].forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tf === state.timeframeId);
      btn.setAttribute('aria-pressed', String(btn.dataset.tf === state.timeframeId));
    });
  }

  async function loadChartForTimeframe(id) {
    const tf = getTimeframe(id);
    const end = Date.now();
    const start = end - tf.rangeMs;
    try {
      const candles = await Hyperliquid.fetchCandles(state.coin, tf.interval, start, end);
      PriceChart.setHistory(candles);
    } catch (e) {
      console.error('[app] failed to load candle history', e);
      showError('Could not load chart history from Hyperliquid. It will keep trying to reconnect.');
    }
  }

  async function selectTimeframe(id) {
    if (id === state.timeframeId) return;
    state.timeframeId = id;
    try {
      localStorage.setItem(CONFIG.STORAGE_TIMEFRAME, id);
    } catch (e) { /* localStorage may be unavailable in private mode */ }
    renderTimeframeButtons();
    const tf = getTimeframe(id);
    state.interval = tf.interval;
    await loadChartForTimeframe(id);
    Hyperliquid.setActiveInterval(tf.interval);
  }

  // ------------------------------------------------------------------
  // 24H HIGH / LOW (independent of chart timeframe)
  // ------------------------------------------------------------------
  async function refreshDayStats() {
    if (!state.coin) return;
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;
    try {
      const candles = await Hyperliquid.fetchCandles(state.coin, CONFIG.STATS_24H_INTERVAL, start, end);
      if (!candles.length) return;
      state.dayHigh = Math.max(...candles.map((c) => c.high));
      state.dayLow = Math.min(...candles.map((c) => c.low));
      renderStats();
    } catch (e) {
      console.error('[app] failed to refresh 24h stats', e);
      // Non-fatal — keep whatever we last had rather than blanking the UI.
    }
  }

  // ------------------------------------------------------------------
  // Alerts UI
  // ------------------------------------------------------------------
  function renderAlert() {
    const alert = Alerts.get();
    if (!alert) {
      els.alertActive.hidden = true;
      return;
    }
    els.alertActive.hidden = false;
    const symbol = alert.condition === 'above' ? '>' : '<';
    const decimals = decimalsFor(alert.price);
    els.alertActiveText.textContent = `${CONFIG.DISPLAY_SYMBOL} ${symbol} $${formatUsd(alert.price, { decimals })}`;
    els.alertToggle.textContent = alert.enabled ? 'Disable' : 'Enable';
    els.alertActive.classList.toggle('is-disabled', !alert.enabled);
  }

  function wireAlertForm() {
    els.alertForm.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const price = parseFloat(els.alertPriceInput.value);
      if (!isFinite(price) || price <= 0) return;
      const condition = els.alertCondition.value === 'below' ? 'below' : 'above';
      Alerts.set(price, condition);
      await Alerts.requestNotificationPermission();
      els.alertPriceInput.value = '';
      renderAlert();
    });

    els.alertToggle.addEventListener('click', () => {
      const alert = Alerts.get();
      if (!alert) return;
      Alerts.setEnabled(!alert.enabled);
      renderAlert();
    });

    els.alertDelete.addEventListener('click', () => {
      Alerts.clear();
      renderAlert();
    });

    els.alertFiredClose.addEventListener('click', () => {
      els.alertFired.hidden = true;
    });
  }

  function showAlertFiredBanner(price) {
    const alert = Alerts.get();
    const decimals = decimalsFor(price);
    els.alertFiredText.textContent = `${CONFIG.DISPLAY_SYMBOL} has reached $${formatUsd(price, { decimals })}`;
    els.alertFired.hidden = false;
    renderAlert();
  }

  // ------------------------------------------------------------------
  // Hyperliquid event wiring
  // ------------------------------------------------------------------
  function wireHyperliquid() {
    Hyperliquid.on('status', renderStatus);

    Hyperliquid.on('price', (tick) => {
      const price = tick.markPx ?? tick.midPx;
      if (price == null || !isFinite(price)) return;

      const prevPrice = state.lastPrice;
      state.lastPrice = price;
      state.lastMessageAt = tick.receivedAt || Date.now();

      if (tick.prevDayPx != null) state.prevDayPx = tick.prevDayPx;
      if (tick.dayNtlVlm != null) state.dayVolume = tick.dayNtlVlm;

      // Keep the running 24h high/low honest even between REST refreshes.
      if (state.dayHigh == null || price > state.dayHigh) state.dayHigh = price;
      if (state.dayLow == null || price < state.dayLow) state.dayLow = price;

      renderPrice(price, prevPrice);
      renderChange();
      renderStats();
      hideError();

      PriceChart.updateCurrentPriceLine(price, state.prevDayPx == null || price >= state.prevDayPx);

      if (Alerts.checkPrice(price)) {
        showAlertFiredBanner(price);
      }
    });

    Hyperliquid.on('candle', (candle) => {
      if (candle.interval !== state.interval) return;
      PriceChart.updateBar(candle);
    });

    Hyperliquid.on('error', (message) => {
      console.error('[Hyperliquid]', message);
    });
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  async function boot() {
    wireAlertForm();
    renderAlert();
    wireHyperliquid();

    els.timeframeBar.addEventListener('click', (evt) => {
      const btn = evt.target.closest('button[data-tf]');
      if (!btn) return;
      selectTimeframe(btn.dataset.tf);
    });

    els.retryButton.addEventListener('click', () => {
      hideError();
      init();
    });

    let savedTf = CONFIG.DEFAULT_TIMEFRAME;
    try {
      savedTf = localStorage.getItem(CONFIG.STORAGE_TIMEFRAME) || CONFIG.DEFAULT_TIMEFRAME;
    } catch (e) { /* ignore */ }
    if (!CONFIG.TIMEFRAMES.some((tf) => tf.id === savedTf)) savedTf = CONFIG.DEFAULT_TIMEFRAME;
    state.timeframeId = savedTf;
    renderTimeframeButtons();

    PriceChart.init(els.chartContainer);

    state.tickTimer = setInterval(renderLastUpdated, 1000);

    await init();
  }

  async function init() {
    try {
      const market = await Hyperliquid.resolveMarket();
      state.coin = market.coin;
      els.symbolBadge.textContent = `${CONFIG.EXCHANGE_LABEL} · ${market.coin}`;

      const tf = getTimeframe(state.timeframeId);
      state.interval = tf.interval;

      await loadChartForTimeframe(state.timeframeId);
      await refreshDayStats();

      if (state.statsTimer) clearInterval(state.statsTimer);
      state.statsTimer = setInterval(refreshDayStats, CONFIG.STATS_REFRESH_MS);

      Hyperliquid.connect(state.coin);
    } catch (e) {
      console.error('[app] failed to initialize market', e);
      showError('Could not reach Hyperliquid to resolve the BTC/USDC market. Check your connection and retry.');
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
