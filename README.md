# BTC/USDC · Live on Hyperliquid

A free, client-side, mobile-first dashboard that streams the live BTC/USDC
spot market from **Hyperliquid** — no backend, no API key, no wallet
connection. Built to be hosted for $0 on GitHub Pages.

---

## 1. What it does

- Streams the live BTC/USDC price, best bid/ask, order book, and recent
  trades directly from Hyperliquid's public WebSocket.
- Shows 24h change, high, low, and volume.
- Renders a candlestick chart (1m / 5m / 15m / 1h / 4h / 1d) using real
  Hyperliquid candle data, live-updating as new bars form.
- Lets you set a client-side price alert (with an optional sound and
  browser notification) — stored only in your browser's `localStorage`.
- Reconnects automatically with exponential backoff if the connection
  drops, and never shows "LIVE" unless it's actually receiving valid data.
- Is strictly **read-only**: it never asks for a wallet, private key, or
  seed phrase, and it cannot place, modify, or cancel any order.

## 2. Hyperliquid API architecture

```
Browser
   │  WebSocket (wss://api.hyperliquid.xyz/ws)
   ▼
Hyperliquid public market data
   │  allMids / l2Book / trades / candle channels
   ▼
JavaScript (js/hyperliquid.js)
   │
   ▼
Chart + UI (js/app.js, js/chart.js)
```

Two Hyperliquid surfaces are used, both public and unauthenticated:

- **Info endpoint (REST)** — `POST https://api.hyperliquid.xyz/info` — used
  once at load for market metadata (`spotMeta`), 24h reference stats
  (`spotMetaAndAssetCtxs`), and historical candles (`candleSnapshot`).
- **WebSocket** — `wss://api.hyperliquid.xyz/ws` — used continuously for
  live price, order book, trade, and candle updates.

Official docs:
- API overview: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
- Info endpoint: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- Spot info endpoints: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot
- WebSocket: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket
- WebSocket subscriptions: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions

## 3. Exact BTC/USDC market identifier

This is the part most integrations get wrong, so it's worth spelling out.

Hyperliquid's own docs state that for spot markets, the `coin` identifier
used in requests is **not** a human-readable ticker — it's `PURR/USDC` for
the PURR pair, and `@{index}` for every other spot pair, where `index` is
that pair's position in the `universe` array returned by the `spotMeta`
info method.

What's shown as **"BTC/USDC"** in the Hyperliquid app actually corresponds
to the underlying HyperCore token **`UBTC`** (Bitcoin, tokenized onto
Hyperliquid via the Unit protocol) paired against USDC — **not** a token
literally named "BTC". Because the numeric index can change if Hyperliquid
reorders the spot universe, this dashboard **never hard-codes** it. Instead,
on every load, `js/hyperliquid.js`:

1. Calls `spotMeta` and finds the token named `UBTC` (falling back to `BTC`
   if that ever changes) in the `tokens` array, noting its token `index`.
2. Finds the entry in the `universe` array whose `tokens` field is
   `[thatIndex, 0]` (`0` is USDC, the universal spot quote token).
3. Builds the wire identifier as `@{universe_entry.index}`.

That resolved identifier — shown in the dashboard's "Market Data Details"
panel — is what's used for every subsequent REST and WebSocket call.

## 4. How live price data works

On connect, the client subscribes to three channels for the resolved
market: `l2Book` (order book → best bid/ask/spread), `trades` (recent
trade tape), and `candle` (the active timeframe's OHLCV bars). The
headline price is taken from the mid/mark price implied by the order
book and trade stream as it updates live; every incoming WebSocket
message is validated before touching the UI (missing fields, non-numeric
prices, and malformed payloads are all discarded, not rendered).

## 5. How historical candles work

Chart history is loaded once per timeframe via the `candleSnapshot` info
method (`{"type":"candleSnapshot","req":{"coin": "<resolved id>",
"interval": "...", "startTime": ..., "endTime": ...}}`), then kept live by
the `candle` WebSocket subscription, which pushes an updated bar every
time the current candle changes. Switching timeframes unsubscribes the old
`candle` feed, re-fetches history for the new interval, and subscribes to
the new one — no page reload required.

24h high/low is computed from the last 24 hourly candles (Hyperliquid's
asset-context response doesn't expose high/low directly), rather than
being estimated or fabricated.

## 6. How to deploy to GitHub Pages

1. Create a new GitHub repository, e.g. `btc-usdc-hyperliquid`.
2. Add all the files from this project, preserving the folder structure:
   ```
   btc-usdc-hyperliquid/
   ├── index.html
   ├── css/style.css
   ├── js/config.js
   ├── js/hyperliquid.js
   ├── js/chart.js
   ├── js/alerts.js
   ├── js/app.js
   ├── assets/btc.svg
   └── README.md
   ```
3. Commit and push to the `main` branch.
4. In the repository, go to **Settings → Pages**.
5. Under **Build and deployment → Source**, choose **Deploy from a
   branch**.
6. Under **Branch**, choose `main` and folder `/ (root)`, then **Save**.
7. Wait 1–2 minutes. Your dashboard will be live at:
   ```
   https://USERNAME.github.io/btc-usdc-hyperliquid/
   ```

All asset paths in this project are relative (`css/style.css`,
`js/app.js`, `assets/btc.svg`, …), so it works whether it's served from
the repository root or a subdirectory — no configuration changes needed.

## 7. How to configure alerts

1. Open the **Price Alert** panel.
2. Enter a target price, choose **Above** or **Below**, and tap **Set
   Alert**.
3. The alert is saved in your browser's `localStorage` — it persists
   across reloads on the same device/browser, but isn't sent anywhere.
4. When the live price crosses your target, you'll see an on-screen
   banner, and, if you've granted permission, a browser notification.
5. Toggle **🔊 Alert Sound** to also play a short tone. Browsers block
   audio until you've interacted with the page at least once, so the
   first alert after a fresh page load may be silent if you haven't
   clicked/tapped anything yet — interacting with any control (like the
   alert form itself) unlocks audio for the rest of the session.
6. Tap **Clear** next to the active-alert label to remove it.

## 8. How reconnection works

If the WebSocket disconnects for any reason, the client:

1. Immediately updates the status indicator to `🔴 DISCONNECTED`, then
   `🟡 RECONNECTING`.
2. Waits, then retries, following exponential backoff: 1s → 2s → 4s → 8s →
   16s → 30s (capped).
3. Re-subscribes to `l2Book`, `trades`, and `candle` for the resolved
   market as soon as the socket reopens.
4. Resets the backoff counter back to 1s after a successful reconnect.
5. Never opens a second, duplicate socket while one is already
   connecting/open.

The dashboard only ever shows `🟢 LIVE` once it has received a real,
validated data message from Hyperliquid — not merely once the socket has
opened.

## 9. API limitations

- Hyperliquid's public WebSocket enforces per-IP limits on the number of
  simultaneous subscriptions, connections, and messages — this dashboard
  uses a small, fixed number of subscriptions (well within those limits)
  for a single market.
- `candleSnapshot` only returns the most recent 5,000 candles per request;
  this dashboard requests a bounded lookback window per timeframe.
- The spot asset-context response does not include 24h high/low, so those
  are derived client-side from the last 24 hourly candles rather than
  provided directly by the API.
- Latency is only displayed when it can be measured from real message
  timestamps; if it can't be calculated reliably, it's omitted rather than
  guessed.

## 10. Security considerations

- **Read-only, always.** This dashboard never requests a wallet
  connection, private key, or seed phrase, and contains no code path that
  can sign, place, modify, or cancel an order.
- **No API key required.** Every endpoint used here is Hyperliquid's
  public, unauthenticated market-data surface.
- **No backend, no database, no server-side secrets.** Everything runs in
  your browser; the only network calls are to `api.hyperliquid.xyz`.
- **Local-only alert storage.** Your price alert configuration lives in
  `localStorage` on your device and is never transmitted anywhere.
- All incoming WebSocket messages are validated before touching the UI —
  malformed or unexpected payloads are discarded rather than crashing the
  app.

---

Built with vanilla HTML, CSS, and JavaScript, plus
[Lightweight Charts](https://github.com/tradingview/lightweight-charts)
(loaded from a public CDN) for the candlestick chart. No frameworks, no
build step.
