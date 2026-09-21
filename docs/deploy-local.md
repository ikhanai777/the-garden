# Local deployment runbook

Written to be executed step by step by an agent (or a person) on the target
machine. Every step has a verification. **Do not proceed past a failed
verification** — each failure mode below produces the same symptom in the UI (an
empty dashboard), so diagnosing later is much harder than stopping now.

---

## Rules for the executing agent

Read these before running anything.

1. **Real data only.** This system reads live Binance USDⓈ-M market data. There
   is no demo mode, no mock feed, and no sample dataset in the runtime path. If
   market data cannot be reached, the correct outcome is a **failed preflight**,
   not a dashboard showing numbers.
2. **Never fabricate a verification result.** Paste the actual command output.
   If a check fails, report the failure and stop.
3. **The one synthetic thing is `npm test`**, which replays generated candles to
   check arithmetic and invariants offline. It is a unit test. It is never a
   data source for the dashboard, and passing it says nothing about market
   connectivity.
4. **No API key is needed or wanted.** Every endpoint used is public market
   data. If any step appears to ask for an API key, secret, or wallet, stop —
   that is not part of this system.
5. **An empty dashboard is sometimes correct.** After preflight passes, "no
   signals" means no setup currently qualifies. See *Operating notes*.

---

## Prerequisites

| Requirement | Why | Check |
| --- | --- | --- |
| Node.js **22.18+** (24 LTS recommended) | CLIs are `.ts` files run directly by Node's native type stripping | `node --version` |
| npm 10+ | ships with Node | `npm --version` |
| Git | to fetch the repo | `git --version` |
| Network in a region where Binance futures is available | the API region-blocks some jurisdictions, **including the US** | step 4 checks this |
| A modern browser (Chrome, Edge, Firefox) | the dashboard streams market data over WebSocket | — |

If `node --version` prints below v22.18, install Node 24 LTS from
<https://nodejs.org> and re-open the terminal before continuing.

**On the US / region blocks:** Binance futures (`fapi.binance.com`) returns HTTP
451 to blocked regions. `binance.us` is a different exchange, has no futures
market, and cannot be substituted. If the preflight reports a region block, this
system cannot run on that network — report that and stop.

---

## Step 1 — Get the code

```bash
git clone https://github.com/ikhanai777/the-garden.git
cd the-garden
git checkout claude/binance-futures-signals-w0aph9
```

**Verify:** `git rev-parse --abbrev-ref HEAD` prints
`claude/binance-futures-signals-w0aph9`.

---

## Step 2 — Install dependencies

```bash
npm install
```

**Verify:** the command exits 0 and a `node_modules/` directory exists. Warnings
about optional peers are fine; an `ERR!` block is not.

---

## Step 3 — Offline sanity check

```bash
npm test
```

This needs no network. It checks indicator arithmetic, plan invariants (stop on
the correct side, prices on the exchange tick grid, reward:risk floors, time-stop
compliance), and runs a look-ahead test asserting that replaying a driftless
random walk does **not** produce positive expectancy.

**Verify:** the last line reads `all checks passed`. The driftless expectancy
line should print a **negative** number (around `-0.24R`) — that is fees and
pessimistic fills on an edgeless input, and it is the evidence the backtester
is not peeking at future bars.

If this fails, stop. Something is wrong with the checkout or the Node version.

---

## Step 4 — Network preflight (the important one)

```bash
npm run signals:doctor
```

This checks, in order: Node runtime, WebSocket support, futures REST
reachability, region blocking, **local clock accuracy against exchange time**,
that the watchlist symbols are real tradable USDT perpetuals, that 300+ bars of
1m history are available, and that the market data WebSocket actually delivers
frames.

**Verify:** exit code 0 and a final line of
`All checks passed. Start the dashboard with: npm start`.

`WARN` lines are acceptable — the system runs. `FAIL` lines are blocking.

| FAIL | Meaning | Fix |
| --- | --- | --- |
| `HTTP 451` | Binance region-blocks this IP | Run on a network in a supported region. Not fixable in software. |
| `HTTP 403` | Refused before reaching the API | Usually a proxy, corporate firewall, or DNS filter. Check `HTTPS_PROXY`. Confirm with `curl -sS -o /dev/null -w '%{http_code}\n' https://fapi.binance.com/fapi/v1/time`. |
| `clock accuracy` | Local clock off exchange time by >5s | Enable network time sync. Windows: *Settings → Time & Language → Date & time → Sync now*. macOS/Linux: enable NTP. The engine mis-times forming bars without it. |
| `market data websocket` | HTTPS works but WebSockets are blocked | Common with inspecting proxies. The dashboard cannot function without it. |
| `watchlist symbols` | A symbol is not a tradable USDT perpetual | Use valid ones, e.g. `npm run signals:doctor -- --symbols BTCUSDT,ETHUSDT,SOLUSDT`. |

Do not continue while any FAIL is present.

---

## Step 5 — Prove it on real history

```bash
npm run signals:backtest -- --symbols SOLUSDT,DOGEUSDT,XRPUSDT --days 14
```

This pulls real 1m klines from Binance and replays them through the same
decision path the live engine uses. It takes a minute or two.

**Verify:** a results table prints, with a line reading
`this geometry needs N% wins to break even; it measured M%`.

**Report both numbers.** This is the first real-data evidence of whether the
strategy has an edge on these symbols. Interpretation:

- `M` comfortably above `N` over a few hundred trades → the candle-derived
  skeleton of the strategy is working.
- `M` at or below `N` → the defaults need tuning before the live signals are
  worth acting on. Report this rather than proceeding silently.
- Very few trades → the volatility floor is filtering the watchlist. Try more
  volatile symbols or a longer `--days` window.

The replay has no order book or live trade flow, so it deliberately scores
fewer factors than the live engine. It is a floor, not a forecast.

---

## Step 6 — Build and serve the dashboard

```bash
npm start
```

This compiles the production build and serves it on <http://127.0.0.1:4173>.
Leave the terminal running — closing it stops the server.

**Verify:** the terminal prints `Local: http://localhost:4173/`.

For development with hot reload use `npm run dev` (port 5173) instead. Either
works; `npm start` is the one to leave running.

---

## Step 7 — Open the dashboard

Navigate to:

```
http://localhost:4173/#/signals
```

The `#/signals` fragment is required — the bare root serves a different app
(an agent supervision console) that shares this repo.

**Verify all four, and report what you actually see:**

1. The status dot next to "Scalp Desk" reads **live** in green within ~10
   seconds. `connecting` → `live` is normal. `stalled` or `reconnecting` that
   persists means the socket is being interrupted.
2. The **watchlist** on the left shows a price for every symbol within ~15
   seconds. Prices should visibly tick.
3. Each watchlist row shows a score bar and a reason line. Early on this reads
   `warming up (N/210 bars)` — normal, it clears once history seeds.
4. No red error banner under the header.

If prices never appear but preflight passed, open the browser devtools console
and report any errors there.

---

## Step 8 (optional) — Terminal feed alongside the dashboard

In a second terminal, in the same directory:

```bash
npm run signals:live
```

Same engine, printing to stdout: each signal with entry band, stop, both
targets, size, and a running scoreboard as positions resolve. Useful for
keeping a record that survives a browser refresh (see *Known limitations*).

`Ctrl+C` prints a final scoreboard and exits.

---

## Operating notes

**Silence is a result.** The engine is built to refuse trades it cannot pay
for. Round-trip friction is ~8 bps; a 1-minute bar on BTC is often 5–10 bps of
total range. On a calm session with only majors on the watchlist, the correct
output is **no signals at all**. The watchlist shows each symbol's live score
and the exact reason it was skipped, so you can tell "quiet market" from
"broken feed" at a glance.

**Expected frequency** with defaults (6 symbols, score threshold 72): a handful
of signals per hour during active sessions, sometimes none for hours when
volatility is low. If you want more, the honest levers are more volatile
symbols and more of them — not a lower threshold.

**Tuning** is in the UI's settings panel (persists in browser localStorage) or
in `src/signals/config.ts` for the CLIs. Every setting has a comment explaining
what it protects against. Lowering `minScore` or `minAtrPct` increases
frequency by admitting weaker evidence; it does not improve accuracy.

**Judge it by the scoreboard.** Every signal is tracked to TP1/TP2/stop/time
stop. Compare the measured hit rate against the break-even win rate printed on
each card. Nothing below ~30 resolved signals is statistically meaningful, and
the panel says so.

**Machine must stay awake.** The engine only runs while the browser tab is open.
Disable sleep/hibernation if you intend to leave it collecting overnight.

**LAN access (optional).** `npm start` binds localhost only. To reach it from
another device on your network, run
`npx vite preview --port 4173 --host` and browse to the printed LAN address.
Only do this on a network you trust; there is no authentication.

---

## Known limitations

- **Signal history is in memory.** Refreshing the browser tab clears the
  scoreboard. Settings persist; results do not. Use `npm run signals:live` if
  you need a session record that outlives a refresh, or add persistence to
  `SignalTracker` if you want it in the UI.
- **The backtester cannot reproduce order-book or live-flow factors,** so
  replayed and live scores are not directly comparable.
- **Slippage is a flat allowance.** A real stop in a fast market can fill far
  worse than the level, which makes the worst losses fatter than the −1R the
  model assumes.
- **Read-only by design.** Nothing here connects to an exchange account or
  places an order. Signals are informational and are not financial advice.

---

## Quick reference

```bash
npm test                      # offline: arithmetic, invariants, look-ahead check
npm run signals:doctor        # network preflight — run this first
npm run signals:backtest -- --days 14 --symbols SOLUSDT,DOGEUSDT
npm run signals:live          # terminal feed
npm start                     # build + serve dashboard on :4173
npm run dev                   # dev server with hot reload on :5173
```

Every CLI supports `-- --help`.

Strategy internals, the factor model, and the risk geometry are documented in
[`scalp-desk.md`](scalp-desk.md).
