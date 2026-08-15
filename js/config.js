/**
 * config.js
 * Central configuration for the BTC/USDC Hyperliquid dashboard.
 * No secrets, no keys, no user credentials live here or anywhere in this app.
 */
const CONFIG = Object.freeze({
  // --- Hyperliquid endpoints (mainnet) ---
  REST_URL: 'https://api.hyperliquid.xyz/info',
  WS_URL: 'wss://api.hyperliquid.xyz/ws',

  // --- Market identification ---
  // Hyperliquid spot markets are addressed as "@<index>" (except PURR/USDC,
  // which is addressed by name). The index for BTC/USDC (the "UBTC/USDC"
  // pair on HyperCore) is NOT hard-coded here: app.js resolves it at runtime
  // from the live `spotMeta` response so the dashboard never trades on a
  // stale or guessed identifier. See hyperliquid.js#resolveMarket().
  BASE_TOKEN_NAME: 'UBTC',      // on-chain token backing BTC on HyperCore
  QUOTE_TOKEN_NAME: 'USDC',
  DISPLAY_SYMBOL: 'BTC/USDC',   // label shown in the UI (matches app.hyperliquid.xyz)
  EXCHANGE_LABEL: 'Hyperliquid',

  // --- Timeframes available on the chart ---
  // range: how far back the chart looks. interval: Hyperliquid candle bucket.
  TIMEFRAMES: [
    { id: '1H', label: '1H', rangeMs: 1 * 60 * 60 * 1000, interval: '1m' },
    { id: '4H', label: '4H', rangeMs: 4 * 60 * 60 * 1000, interval: '5m' },
    { id: '1D', label: '1D', rangeMs: 24 * 60 * 60 * 1000, interval: '15m' },
    { id: '1W', label: '1W', rangeMs: 7 * 24 * 60 * 60 * 1000, interval: '1h' },
    { id: '1M', label: '1M', rangeMs: 30 * 24 * 60 * 60 * 1000, interval: '4h' },
  ],
  DEFAULT_TIMEFRAME: '1D',

  // Candle interval always used for the running 24H HIGH / 24H LOW stat,
  // independent of whatever timeframe the chart is showing.
  STATS_24H_INTERVAL: '1h',

  // --- WebSocket behavior ---
  WS_PING_INTERVAL_MS: 25_000,       // keep-alive ping cadence
  WS_STALE_AFTER_MS: 15_000,         // no message in this long -> treat as stale
  WS_RECONNECT_BASE_MS: 1_000,       // first reconnect delay
  WS_RECONNECT_MAX_MS: 30_000,       // exponential backoff ceiling
  WS_RECONNECT_JITTER_MS: 400,

  // --- REST refresh (only used for things WS doesn't push, e.g. candles) ---
  STATS_REFRESH_MS: 60_000,          // re-pull 24H high/low candles periodically

  // --- Local storage keys ---
  STORAGE_TIMEFRAME: 'btcUsdcHL:selectedTimeframe',
  STORAGE_ALERT: 'btcUsdcHL:priceAlert',

  // --- UI behavior ---
  PRICE_FLASH_MS: 400,
  STALE_LABEL_AFTER_MS: 20_000,      // "last updated" copy switches to a warning
});
