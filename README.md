# BTC/USDC · Hyperliquid Live Price Dashboard

A free, static, mobile-first dashboard that monitors the BTC/USDC spot
price on **Hyperliquid** in real time. It is read-only: there is no
trading, no order placement, and no wallet connection anywhere in this
app.

---

## 1. Project overview

This app shows exactly one thing well: the live BTC/USDC price on
Hyperliquid.

- Large current price, 24H change (absolute + %), 24H high/low/volume
- A live, timeframe-switchable price chart (1H / 4H / 1D / 1W / 1M)
- A connection indicator (LIVE / CONNECTING / RECONNECTING / DISCONNECTED)
- An optional client-side price alert (localStorage + browser notification)

No order book, no bid/ask, no recent-trades table, no buy/sell buttons.
It is a monitoring dashboard, not a trading terminal.

## 2. Hyperliquid API architecture

All data comes from Hyperliquid's public Info API and WebSocket API —
no API key, no account, and no signing is required for any of it,
because everything used here is public market data.

```
Browser
  │
  ├── REST  POST https://api.hyperliquid.xyz/info
  │         → resolve the exact market id, seed chart candles,
  │           compute the rolling 24H high/low
  │
  └── WS    wss://api.hyperliquid.xyz/ws
            → live price context + live candle updates
```

## 3. WebSocket architecture

```
Browser
   ↓ subscribe {"type":"activeAssetCtx","coin":"@<index>"}
   ↓ subscribe {"type":"candle","coin":"@<index>","interval":"<tf>"}
Hyperliquid WebSocket
   ↓ channel "activeSpotAssetCtx" → live markPx / midPx / prevDayPx / dayNtlVlm
   ↓ channel "candle"             → live OHLC bar for the active timeframe
Dashboard
   → price, 24H change, 24H stats, and chart all update without polling
```

`js/hyperliquid.js` owns the socket lifecycle:

- **One socket at a time.** `openSocket()` no-ops if a socket is already
  open or connecting, so rapid reconnect attempts can never stack.
- **Heartbeat.** A `{"method":"ping"}` frame is sent every 25s to keep the
  connection alive per Hyperliquid's timeout/heartbeat rules.
- **Staleness watchdog.** If no message arrives for 15s, the UI stops
  claiming `LIVE`, the socket is closed, and a clean reconnect begins —
  so the dashboard never shows a stale price as if it were live.
- **Exponential backoff.** Reconnects start at 1s and double up to a
  30s ceiling, with a little random jitter, and resubscribe to the same
  channels automatically once reconnected.

## 4. Exact BTC/USDC market identifier

Hyperliquid spot markets are addressed as `@<universe index>` (the only
exception is `PURR/USDC`, which is addressed by name). That index is
**not hard-coded** in this project — it's resolved at runtime:

1. On load, the app calls `POST /info {"type":"spotMeta"}`.
2. It finds the token named `UBTC` (the token that backs BTC on
   HyperCore) and the token named `USDC`.
3. It finds the entry in `universe` whose `tokens` pair is
   `[UBTC_index, USDC_index]`, and reads that entry's `index`.
4. The market id used for every REST/WS call is `@<that index>`.

Why `UBTC` and not `BTC`: on Hyperliquid, the pair labeled **BTC/USDC**
in `app.hyperliquid.xyz`'s own UI corresponds on-chain to the spot pair
**UBTC/USDC** on HyperCore. This app follows Hyperliquid's own mapping —
it is not a substitution to a different asset or a different quote
currency, and the dashboard always labels the pair as **BTC/USDC** to
match what you'd see on Hyperliquid itself. If this resolution step
ever fails (e.g. Hyperliquid restructures its spot universe), the app
shows a clear error banner instead of guessing an index or fabricating
a price.

## 5. How live price updates work

The `activeAssetCtx` WebSocket subscription (which Hyperliquid returns
under the channel name `activeSpotAssetCtx` for spot markets) pushes,
on every price-relevant change:

| Field        | Used for                              |
|--------------|----------------------------------------|
| `markPx`     | the headline current price             |
| `midPx`      | fallback if `markPx` is briefly absent |
| `prevDayPx`  | 24H change (absolute and %)            |
| `dayNtlVlm`  | 24H volume, in USDC notional           |

The price element flashes green/red for 300–500ms on each tick, and the
running 24H high/low are extended live if the price crosses them
between REST refreshes.

## 6. How historical chart data works

Chart candles come from `POST /info {"type":"candleSnapshot", ...}`.
Each timeframe button maps to a lookback window and a candle interval:

| Timeframe | Range   | Candle interval |
|-----------|---------|------------------|
| 1H        | 1 hour  | 1m               |
| 4H        | 4 hours | 5m               |
| 1D        | 1 day   | 15m              |
| 1W        | 1 week  | 1h               |
| 1M        | 30 days | 4h               |

Switching timeframes re-fetches history for that window and
re-subscribes the `candle` WebSocket feed to the matching interval, so
the visible chart keeps updating live without a page refresh. The
independent **24H HIGH / 24H LOW** stat always uses 1h candles over the
trailing 24 hours, refreshed every 60s, regardless of which timeframe
the chart is showing.

The selected timeframe is remembered in `localStorage`.

## 7. How price alerts work

Alerts are entirely client-side — there is no backend to hold them:

- Set a target price and **Above**/**Below**, stored in `localStorage`.
- Every incoming price tick is checked against the active alert.
- On a cross, the dashboard shows an in-page toast and, if you granted
  permission, a browser notification.
- You can disable, re-enable, or delete the alert at any time.

Because there's no server, an alert only fires while this tab is open
in your browser. That's stated in the UI so it isn't a surprise.

## 8. GitHub Pages deployment

1. Create a new GitHub repository, e.g. `btc-usdc-hyperliquid`.
2. Upload this project's contents to the repository root (keep the
   `css/`, `js/`, and `assets/` folders intact — don't nest everything
   inside an extra subfolder).
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a
   branch**.
5. Choose the `main` branch and the `/ (root)` folder, then **Save**.
6. Wait a minute or two, then open the URL GitHub shows you:
   `https://USERNAME.github.io/REPOSITORY/`

No build step, no server, no environment variables — it's plain
HTML/CSS/JS plus one CDN script tag for the charting library.

### Step-by-step: uploading via the GitHub website (no git required)

1. Go to github.com, sign in, click **New repository**, name it, and
   create it (public, no README needed since one is included here).
2. Click **Add file → Upload files**.
3. Drag in `index.html`, `README.md`, and the `css/`, `js/`, `assets/`
   folders together.
4. Scroll down and click **Commit changes**.
5. Follow steps 3–6 above to enable Pages.

## 9. Troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| Stuck on "CONNECTING" | Network blocks WebSocket connections | Some corporate/school networks block `wss://`; try another network |
| "Could not reach Hyperliquid to resolve the BTC/USDC market" | The one-time `spotMeta` REST call failed | Check your connection, click **Retry**; if it persists, Hyperliquid's API may be down |
| Price briefly shows "DISCONNECTED" then recovers | Normal — the staleness watchdog force-reconnects after 15s of silence | No action needed |
| Alert never fires | Tab was closed or the browser blocked notifications | Keep the tab open; check the site's notification permission |
| Chart looks empty after switching timeframe | Candle history request failed | An error banner should appear; click **Retry** |

## 10. API limitations

- **Public data only.** This app uses no API key and no signed
  requests, so it's limited to what Hyperliquid's public Info/WebSocket
  endpoints expose — no user-account data of any kind is requested.
- **No native 24H high/low endpoint.** Hyperliquid's market-context
  endpoints expose `markPx`/`midPx`/`prevDayPx`/volume, but not a
  ready-made 24H high/low, so this app derives them from 1h candles
  over the trailing 24 hours and extends them live as new ticks arrive.
- **Rate limits.** Hyperliquid enforces per-IP WebSocket subscription
  and REST rate limits. This app subscribes to only two channels
  (`activeAssetCtx` and one `candle` interval at a time) and avoids
  polling, staying well within normal limits.
- **Best-effort backfill.** `candleSnapshot` history depth can vary by
  interval; very long lookbacks on fine intervals may return fewer
  candles than requested.

---

Built with vanilla HTML/CSS/JS + [Lightweight Charts](https://github.com/tradingview/lightweight-charts) (loaded from a CDN). No frameworks, no bundler, no backend.
