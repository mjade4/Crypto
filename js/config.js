/**
 * config.js
 * Central configuration for the Hyperliquid BTC/USDC dashboard.
 * No secrets, no API keys — every endpoint here is public market data.
 */

const CONFIG = Object.freeze({
  // Official Hyperliquid public endpoints (mainnet).
  // Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
  INFO_URL: 'https://api.hyperliquid.xyz/info',
  WS_URL: 'wss://api.hyperliquid.xyz/ws',

  // The base token symbol we're looking for in spotMeta's token list.
  // Hyperliquid remaps "BTC/USDC" (as shown on app.hyperliquid.xyz) to the
  // underlying HyperCore token "UBTC" paired against USDC (token index 0).
  // We NEVER hard-code the market's numeric index — it is resolved at
  // runtime from spotMeta so the dashboard keeps working if Hyperliquid
  // reorders the spot universe.
  BASE_TOKEN_CANDIDATES: ['UBTC', 'BTC'],
  QUOTE_TOKEN_NAME: 'USDC',
  QUOTE_TOKEN_INDEX: 0,

  // Fallback used only if dynamic resolution fails entirely (see hyperliquid.js).
  // This is a last-resort display label, never sent to the API as a symbol.
  FALLBACK_DISPLAY_NAME: 'UBTC/USDC',

  // Timeframe buttons -> Hyperliquid candle "interval" strings + duration in ms.
  TIMEFRAMES: [
    { key: '1m', label: '1M', ms: 60 * 1000 },
    { key: '5m', label: '5M', ms: 5 * 60 * 1000 },
    { key: '15m', label: '15M', ms: 15 * 60 * 1000 },
    { key: '1h', label: '1H', ms: 60 * 60 * 1000 },
    { key: '4h', label: '4H', ms: 4 * 60 * 60 * 1000 },
    { key: '1d', label: '1D', ms: 24 * 60 * 60 * 1000 },
  ],
  DEFAULT_TIMEFRAME: '15m',

  // How many bars of history to request per timeframe (kept well under the
  // documented 5000-candle-per-request ceiling).
  CANDLE_LOOKBACK_BARS: 300,

  // Reconnection backoff schedule, in ms. Resets to index 0 after a
  // successful, stable connection.
  RECONNECT_DELAYS_MS: [1000, 2000, 4000, 8000, 16000, 30000],

  // Order book depth to render per side.
  ORDER_BOOK_LEVELS: 10,

  // Recent trades panel row cap.
  RECENT_TRADES_MAX: 25,

  // Price flash animation duration (ms) — must stay in the 300-500ms band.
  FLASH_DURATION_MS: 400,

  // localStorage keys.
  STORAGE_KEYS: {
    TIMEFRAME: 'hl_btcusdc_timeframe',
    ALERT: 'hl_btcusdc_alert',
    ALERT_SOUND: 'hl_btcusdc_alert_sound',
  },

  // Rolling-24h stats are derived from 1h candles (24 of them) rather than
  // guessed, since Hyperliquid's spotMetaAndAssetCtxs response does not
  // include high/low fields.
  ROLLING_24H_INTERVAL: '1h',
  ROLLING_24H_BARS: 24,
});
