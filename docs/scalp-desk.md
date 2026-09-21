# Scalp Desk — Binance futures signal engine

A signal provider for 1–10 minute trades on Binance USDⓈ-M perpetual futures. It
runs on live public market data, publishes an entry band, a stop and two
targets for every signal, and then follows each one to a resolution so the hit
rate on screen is measured rather than claimed.

It reads market data only. There is no API key, no signing, and no code path
that can place an order.

## Running it

To deploy on your own machine, follow [the local runbook](deploy-local.md) —
it has preflight checks for the things that silently produce an empty
dashboard (region blocking, blocked WebSockets, clock drift).

```bash
npm install

npm run signals:doctor      # preflight: connectivity, region, clock, symbols
npm start                   # build + serve at http://localhost:4173/#/signals
npm run dev                 # or: dev server at http://localhost:5173/#/signals
npm run signals:live        # the same engine, printing to a terminal
npm run signals:backtest -- --symbols SOLUSDT,DOGEUSDT --days 14
npm test                    # offline wiring + invariant checks
```

`npm run signals:live -- --help` and `npm run signals:backtest -- --help` list
every flag. Both run on Node's native TypeScript support — no build step.

## Where the data comes from

| Input | Source | Why |
| --- | --- | --- |
| 1m candles | `@kline_1m` stream, seeded from `/fapi/v1/klines` | trend, volatility, range structure |
| Aggressive trades | `@aggTrade` | 15s/60s taker-flow imbalance, trade-rate bursts |
| Best bid/ask | `@bookTicker` | spread gate, micro-price |
| 20-level book | `@depth20@100ms` | resting-liquidity imbalance |
| Mark price & funding | `@markPrice@1s` | funding blackout, crowding filter |
| Tick size, lot size | `/fapi/v1/exchangeInfo` | prices land on the real grid; sizing respects filters |

One WebSocket carries every symbol. It reconnects with backoff and treats
silence as failure — a socket that stops delivering is more dangerous than one
that closes, because the engine would otherwise keep scoring stale data.

## How a signal is made

Two playbooks, each scored as a weighted list of measured factors rather than a
chain of ifs. The published score is the fraction of available evidence that
agrees with the trade, so it means something on its own, and every signal can
show its work.

**Momentum** — a 20-bar range break out of a volatility squeeze, with a volume
burst, aligned EMA structure, aggressive taker flow and book pressure behind
it. Entry is the first shallow pullback into the broken level, never the print.

**Reversion** — a flush ≥1.8σ beyond rolling VWAP and outside the 2σ band, with
RSI2 at an extreme, wick rejection, and 15s flow turning against the move while
the book holds. It stands aside when ADX says there is a real trend to fight, or
when the trade rate spikes past 6× baseline — that is a liquidation cascade, not
an opportunity.

Factors marked as **gates** hold a veto: zero kills the setup no matter how good
everything else looks. Factors that need live book or flow data are dropped from
the score's numerator *and* denominator when that data is unavailable, so a
replayed score is computed only from evidence the replay actually had.

On top of the per-setup logic there are global gates: spread, a volatility floor
and ceiling, a funding-settlement blackout, and a crowded-funding filter.

## Risk model

- **Stop** sits beyond the structure that produced the setup, clamped to
  0.45–1.4 ATR. Tighter and 1m noise takes it; wider and a 10-minute hold cannot
  pay for it.
- **Targets** are 1.5R/2.6R for momentum and 1.2R/the mid-band for reversion.
  TP1 scales out 60% and moves the stop to break-even.
- **Tick rounding** always moves targets away from entry and stops toward it, so
  rounding can only make a signal harder to win.
- **Every R:R figure is net** of round-trip fees and slippage.
- **Time stop** closes anything still open after `maxHoldMinutes`.
- **Sizing** comes from account equity × risk-per-trade ÷ stop distance, rounded
  to the exchange's lot step and checked against its minimums.

## The fee problem, stated plainly

This is the constraint that governs the whole design. Round-trip friction is
about 8 bps (maker in, taker out, plus slippage). A 1-minute bar on BTC often
has a total range of 5–10 bps. A scalp that targets "about one ATR" on a quiet
major is therefore a coin flip for negative money, no matter how good the entry
logic is.

The engine's response is to refuse those trades rather than dress them up:

- a volatility floor (`minAtrPct`, default 12 bps) stands the engine down on
  quiet symbols;
- TP1 must clear `minEdgeOverFees` × round-trip cost;
- net R:R must clear 0.6, and every signal publishes the **break-even win rate**
  its own geometry needs — typically 55–62%.

The practical consequence: on a calm session with BTC and ETH on the watchlist,
the correct output is no signals at all. The watchlist panel shows each symbol's
score and the specific reason it was passed over, so silence is legible instead
of looking like a broken feed.

## Measuring it, rather than trusting it

Three layers, in increasing order of what they prove:

1. `npm test` — offline. Checks indicator correctness, plan invariants (stop on
   the right side, prices on the tick grid, R:R floors, time-stop compliance),
   and includes a **look-ahead test**: replaying a driftless random walk must
   *not* produce a positive expectancy. It currently returns about −0.24R per
   trade there, which is the cost of fees and pessimistic fills, i.e. what an
   edgeless input should produce.
2. `npm run signals:backtest` — real klines. Pessimistic by construction: fills
   take the worst price inside the published band that the bar actually traded,
   and a bar containing both the stop and a target is resolved as a loss, since
   1m data cannot show which came first. It sees no book or flow data, so it
   measures the candle skeleton of the strategy, not the whole thing.
3. The live scoreboard — every published signal is tracked to TP1/TP2/stop/time
   stop, and the panel reports hit rate, expectancy, profit factor and max
   drawdown, with the sample size next to them.

Nothing below roughly 30 resolved trades means anything, and the UI says so.

## Accuracy, honestly

No signal generator is "extremely accurate", and any that claims a fixed hit
rate is either curve-fitted or lying. What is under an engine's control is
selectivity, cost discipline, and honest measurement — all three are what this
one is built around. Judge it by comparing the measured hit rate against the
break-even win rate printed on each signal; if the former is not comfortably
above the latter on a sample of a few hundred trades, the edge is not there.

Two known limits worth stating:

- The backtester cannot reproduce order-book and live-flow factors, so replayed
  and live scores are not directly comparable.
- Slippage is modelled as a flat allowance. A real stop in a fast market can
  fill far worse than the level, which makes the worst losses fatter than the
  −1R the model assumes.

## Configuration

Every tunable lives in `src/signals/config.ts` with a comment explaining what it
protects against. The UI's settings panel writes to `localStorage`; the CLIs
take flags. Changing settings affects future signals only — the scoreboard's
history was measured under whatever was in force at the time.

## Layout

```
src/signals/
  config.ts       tunables and endpoints
  types.ts        domain types
  indicators.ts   EMA/RSI/ATR/ADX/VWAP/Bollinger primitives
  exchange.ts     REST: klines, filters, funding, liquidity, latency
  stream.ts       combined WebSocket with reconnect + stall detection
  features.ts     raw market state → measured inputs
  strategy.ts     the two playbooks, as weighted factor lists
  risk.ts         entry band, stop, targets, sizing, ETA
  tracker.ts      live outcome tracking and performance stats
  backtest.ts     kline replay through the same decision path
src/components/signals/   the terminal UI
scripts/                  live feed, backtest, and offline self-test CLIs
```

## Disclaimer

These signals are informational and are not financial advice. Leveraged
perpetual futures can lose more than the margin posted. Nothing here connects to
an exchange account or places an order.
