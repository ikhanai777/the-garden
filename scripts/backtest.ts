/**
 * Measures the strategy on real Binance USDⓈ-M history.
 *
 *   node scripts/backtest.ts --symbols BTCUSDT,SOLUSDT --days 14
 *   node scripts/backtest.ts --symbols SOLUSDT --days 30 --min-score 78 --json
 *
 * Replay sees candle-derived evidence only — no order book, no live taker-flow
 * windows, no spread. Those factors are dropped from the score entirely rather
 * than guessed at, so these numbers are a floor on what the live engine looks
 * at, not a forecast of it. Treat the output as "is the candle skeleton of
 * this strategy sound", then confirm on the live tracker's own hit rate.
 */

import { parseArgs } from 'node:util'
import { backtest } from '../src/signals/backtest.ts'
import { DEFAULT_CONFIG } from '../src/signals/config.ts'
import { fetchKlineHistory, fetchSymbolFilters } from '../src/signals/exchange.ts'
import { summarise } from '../src/signals/tracker.ts'
import type { BacktestResult } from '../src/signals/backtest.ts'
import type { TrackedSignal } from '../src/signals/types.ts'

const { values } = parseArgs({
  options: {
    symbols: { type: 'string', default: DEFAULT_CONFIG.symbols.join(',') },
    days: { type: 'string', default: '7' },
    interval: { type: 'string', default: '1m' },
    'min-score': { type: 'string' },
    'fee-bps': { type: 'string' },
    equity: { type: 'string' },
    risk: { type: 'string' },
    json: { type: 'boolean', default: false },
    trades: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  console.log(`usage: node scripts/backtest.ts [options]

  --symbols   comma-separated, default ${DEFAULT_CONFIG.symbols.join(',')}
  --days      days of history to pull, default 7
  --interval  kline interval, default 1m
  --min-score conviction threshold, default ${DEFAULT_CONFIG.minScore}
  --fee-bps   round-trip commission, default ${DEFAULT_CONFIG.feeBps}
  --equity    account size for sizing, default ${DEFAULT_CONFIG.equityUsd}
  --risk      fraction of equity per trade, default ${DEFAULT_CONFIG.riskPerTrade}
  --trades    print every trade
  --json      emit machine-readable output`)
  process.exit(0)
}

const symbols = String(values.symbols)
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)
const days = Number(values.days)
const config = {
  ...DEFAULT_CONFIG,
  symbols,
  ...(values['min-score'] ? { minScore: Number(values['min-score']) } : {}),
  ...(values['fee-bps'] ? { feeBps: Number(values['fee-bps']) } : {}),
  ...(values.equity ? { equityUsd: Number(values.equity) } : {}),
  ...(values.risk ? { riskPerTrade: Number(values.risk) } : {}),
}

const endTime = Date.now()
const startTime = endTime - days * 24 * 60 * 60 * 1000

const filters = await fetchSymbolFilters()
const results: BacktestResult[] = []
const everySignal: TrackedSignal[] = []

for (const symbol of symbols) {
  const filter = filters.get(symbol)
  if (!filter) {
    console.error(`skipping ${symbol}: not a tradable USDT perpetual`)
    continue
  }
  if (!values.json) process.stderr.write(`fetching ${symbol}… `)
  const candles = await fetchKlineHistory(symbol, String(values.interval), startTime, endTime)
  if (!values.json) process.stderr.write(`${candles.length} bars\n`)

  const result = backtest({ symbol, candles, filters: filter, config })
  results.push(result)
  everySignal.push(...result.signals)
}

if (values.json) {
  console.log(JSON.stringify({ config, results: results.map(strip) }, null, 2))
  process.exit(0)
}

console.log(
  `\n${days}d of ${values.interval} data · min score ${config.minScore} · ` +
    `${config.feeBps}bps fees + ${config.slippageBps}bps slippage\n`,
)
console.log(
  pad('symbol', 10) +
    pad('sig', 5) +
    pad('fill', 5) +
    pad('win%', 7) +
    pad('exp R', 8) +
    pad('PF', 7) +
    pad('tot R', 8) +
    pad('maxDD', 7) +
    pad('hold', 7),
)
console.log('─'.repeat(64))
for (const r of results) console.log(row(r.symbol, r.stats))

const portfolio = summarise(everySignal)
console.log('─'.repeat(64))
console.log(row('ALL', portfolio))

console.log(`\nbreakdown by setup`)
for (const setup of ['momentum', 'reversion'] as const) {
  const b = portfolio.bySetup[setup]
  const wr = b.filled > 0 ? (b.wins / b.filled) * 100 : 0
  const exp = b.filled > 0 ? b.totalR / b.filled : 0
  console.log(`  ${pad(setup, 12)}${pad(String(b.filled), 6)}trades  ${wr.toFixed(1)}% win  ${exp.toFixed(3)}R expectancy`)
}

const beRates = everySignal.map((s) => s.plan.breakEvenWinRate)
if (beRates.length > 0) {
  const meanBe = beRates.reduce((a, b) => a + b, 0) / beRates.length
  console.log(
    `\nthis geometry needs ${(meanBe * 100).toFixed(1)}% wins to break even; ` +
      `it measured ${(portfolio.winRate * 100).toFixed(1)}%`,
  )
}

console.log('\nmost common reasons nothing was published')
const vetoes = new Map<string, number>()
for (const r of results) for (const [reason, count] of r.vetoes) vetoes.set(reason, (vetoes.get(reason) ?? 0) + count)
for (const [reason, count] of [...vetoes].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(count).padStart(7)}  ${reason}`)
}

if (values.trades) {
  console.log('\ntrades')
  for (const s of everySignal.sort((a, b) => a.createdAt - b.createdAt)) {
    console.log(
      `  ${new Date(s.createdAt).toISOString().slice(5, 16)}  ${pad(s.symbol, 10)}${pad(s.side, 6)}${pad(s.setup, 11)}` +
        `score ${s.score.toFixed(0).padStart(3)}  ${pad(s.status, 10)}` +
        `${(s.realisedR ?? 0).toFixed(2).padStart(6)}R  ${Math.round((s.holdMs ?? 0) / 60_000)}min`,
    )
  }
}

console.log(
  '\nReplay excludes order-book and live-flow factors. Live scores see more evidence\n' +
    'and will differ — compare against the tracker\'s own hit rate before trusting either.',
)

function row(label: string, s: ReturnType<typeof summarise>): string {
  return (
    pad(label, 10) +
    pad(String(s.total), 5) +
    pad(String(s.filled), 5) +
    pad(`${(s.winRate * 100).toFixed(1)}%`, 7) +
    pad(s.expectancy.toFixed(3), 8) +
    pad(Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞', 7) +
    pad(s.totalR.toFixed(1), 8) +
    pad(s.maxDrawdownR.toFixed(1), 7) +
    pad(`${(s.avgHoldMs / 60_000).toFixed(1)}m`, 7)
  )
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text.padEnd(width)
}

function strip(r: BacktestResult) {
  return {
    symbol: r.symbol,
    from: r.from,
    to: r.to,
    barsEvaluated: r.barsEvaluated,
    stats: r.stats,
    vetoes: r.vetoes,
    signals: r.signals.map((s) => ({
      id: s.id,
      side: s.side,
      setup: s.setup,
      score: s.score,
      createdAt: s.createdAt,
      status: s.status,
      realisedR: s.realisedR,
      holdMs: s.holdMs,
      plan: s.plan,
    })),
  }
}
