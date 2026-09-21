/**
 * Live signal feed in the terminal, on real Binance market data.
 *
 *   node scripts/live.ts
 *   node scripts/live.ts --symbols SOLUSDT,DOGEUSDT --min-score 78
 *
 * Needs no API key: everything runs off public market-data endpoints, and
 * nothing here can place an order. Signals print as they fire, then update as
 * they fill and resolve; a running scoreboard prints on every resolution so
 * the hit rate is the measured one, not a claim.
 */

import { parseArgs } from 'node:util'
import { DEFAULT_CONFIG } from '../src/signals/config.ts'
import { SignalEngine } from '../src/signals/engine.ts'
import { fetchLiquidSymbols, pingLatency } from '../src/signals/exchange.ts'
import type { TrackedSignal } from '../src/signals/types.ts'

const { values } = parseArgs({
  options: {
    symbols: { type: 'string' },
    top: { type: 'string' },
    'min-score': { type: 'string' },
    equity: { type: 'string' },
    risk: { type: 'string' },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  console.log(`usage: node scripts/live.ts [options]

  --symbols    comma-separated watchlist, default ${DEFAULT_CONFIG.symbols.join(',')}
  --top N      watch the N most liquid USDT perpetuals instead
  --min-score  conviction threshold, default ${DEFAULT_CONFIG.minScore}
  --equity     account size for sizing, default ${DEFAULT_CONFIG.equityUsd}
  --risk       fraction of equity per trade, default ${DEFAULT_CONFIG.riskPerTrade}
  --quiet      only print signals, no status lines`)
  process.exit(0)
}

const symbols = values.top
  ? await fetchLiquidSymbols(Number(values.top))
  : values.symbols
    ? String(values.symbols).split(',').map((s) => s.trim().toUpperCase())
    : DEFAULT_CONFIG.symbols

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`

const clock = (ts: number) => new Date(ts).toISOString().slice(11, 19)

const latency = await pingLatency().catch(() => NaN)
console.log(bold('binance futures scalp signals'))
console.log(dim(`watching ${symbols.join(' ')} · api latency ${Number.isFinite(latency) ? `${latency.toFixed(0)}ms` : 'unknown'}`))
console.log(dim('signals are informational. nothing here places an order.\n'))

const engine = new SignalEngine(
  {
    symbols,
    ...(values['min-score'] ? { minScore: Number(values['min-score']) } : {}),
    ...(values.equity ? { equityUsd: Number(values.equity) } : {}),
    ...(values.risk ? { riskPerTrade: Number(values.risk) } : {}),
  },
  {
    onStatus: (status, detail) => {
      if (!values.quiet) console.log(dim(`[${clock(Date.now())}] stream ${status}${detail ? ` — ${detail}` : ''}`))
    },
    onError: (message) => console.error(red(`[${clock(Date.now())}] ${message}`)),
    onSignal: (s) => printSignal(s),
    onSignalUpdate: (s) => printUpdate(s),
  },
)

function printSignal(s: TrackedSignal): void {
  const p = s.plan
  const dir = s.side === 'LONG' ? green(bold('LONG ')) : red(bold('SHORT'))
  console.log(
    `\n[${clock(s.createdAt)}] ${dir} ${bold(s.symbol)}  ${s.setup}  ` +
      `score ${bold(s.score.toFixed(0))}/100  ~${p.etaMinutes.toFixed(1)}min`,
  )
  console.log(
    `   entry ${p.entry}  (fill band ${p.entryZone[0]}–${p.entryZone[1]}, valid ${Math.round((s.expiresAt - s.createdAt) / 1000)}s)`,
  )
  console.log(`   stop  ${p.stopLoss}   risk ${p.riskBps.toFixed(1)}bps`)
  console.log(`   tp1   ${p.takeProfit1}   net ${p.rr1.toFixed(2)}R      tp2 ${p.takeProfit2}  net ${p.rr2.toFixed(2)}R`)
  console.log(
    `   size  ${p.quantity} (${p.notional.toFixed(0)} USDT, ${p.leverage}x)  ` +
      dim(`needs ${(p.breakEvenWinRate * 100).toFixed(0)}% wins to break even`),
  )
  for (const reason of s.reasons) console.log(dim(`   · ${reason}`))
}

function printUpdate(s: TrackedSignal): void {
  if (s.status === 'active') {
    if (!values.quiet) console.log(dim(`[${clock(s.filledAt ?? Date.now())}] ${s.symbol} filled at ${s.fillPrice}`))
    return
  }
  if (s.status === 'pending') return

  const r = s.realisedR ?? 0
  const tint = r > 0 ? green : r < 0 ? red : yellow
  console.log(
    `[${clock(s.closedAt ?? Date.now())}] ${bold(s.symbol)} ${s.status.toUpperCase()} at ${s.closePrice} ` +
      tint(`${r >= 0 ? '+' : ''}${r.toFixed(2)}R`) +
      dim(` after ${((s.holdMs ?? 0) / 60_000).toFixed(1)}min`),
  )
  printScoreboard()
}

function printScoreboard(): void {
  const st = engine.tracker.stats()
  if (st.filled === 0) return
  console.log(
    dim(
      `   ── ${st.filled} resolved · ${(st.winRate * 100).toFixed(1)}% win · ` +
        `${st.expectancy >= 0 ? '+' : ''}${st.expectancy.toFixed(3)}R expectancy · ` +
        `${st.totalR >= 0 ? '+' : ''}${st.totalR.toFixed(1)}R total · ` +
        `PF ${Number.isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : '∞'} · ` +
        `${st.cancelled} unfilled`,
    ),
  )
}

await engine.start()

if (!values.quiet) {
  setInterval(() => {
    const views = engine.symbolViews
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((v) => `${v.symbol} ${v.score.toFixed(0)}${v.veto ? dim(`(${v.veto})`) : ''}`)
    console.log(dim(`[${clock(Date.now())}] ${engine.streamStatus} · ${views.join(' · ')}`))
  }, 60_000)
}

const shutdown = () => {
  console.log('\n')
  printScoreboard()
  engine.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
