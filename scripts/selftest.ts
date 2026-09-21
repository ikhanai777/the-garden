/**
 * Offline wiring test for the signal engine.
 *
 * Generates synthetic 1m candles with regime switches (trend legs, chop,
 * flushes), replays them through the real backtester, and asserts the
 * invariants every published plan must satisfy.
 *
 * This validates plumbing and risk geometry, NOT edge: a random walk has no
 * microstructure, so the hit rate it prints is noise and is labelled as such.
 * Measure edge with `npm run signals:backtest`, on real klines.
 *
 *   node scripts/selftest.ts
 */

import { backtest } from '../src/signals/backtest.ts'
import { MIN_NET_RR } from '../src/signals/risk.ts'
import { DEFAULT_CONFIG } from '../src/signals/config.ts'
import { computeFeatures } from '../src/signals/features.ts'
import { atr, ema, rsi, roundToTick } from '../src/signals/indicators.ts'
import type { Candle, SymbolFilters, TrackedSignal } from '../src/signals/types.ts'

let failures = 0

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Deterministic PRNG so a failure can be reproduced. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Regime-switching price path: quiet chop, trending legs, and occasional
 * flushes, so both playbooks get something to look at.
 */
function synthesiseCandles(count: number, seed = 7, driftless = false): Candle[] {
  const rand = mulberry32(seed)
  const gauss = () => {
    const u = Math.max(rand(), 1e-9)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }

  const candles: Candle[] = []
  const start = Date.UTC(2026, 0, 1)
  let price = 150
  let drift = 0
  // an active alt: 15-45 bps of 1m range, the regime where a scalp can clear costs
  let vol = 0.0020
  let regime = 0

  for (let i = 0; i < count; i++) {
    if (i % 90 === 0) {
      regime = Math.floor(rand() * 3)
      drift = driftless || regime === 0 ? 0 : (regime === 1 ? 1 : -1) * 0.0009 * (0.5 + rand())
      vol = 0.0012 + rand() * 0.0030
    }
    // periodic flush: a fast dislocation the reversion book should see
    const shock = rand() < 0.012 ? (rand() < 0.5 ? -1 : 1) * vol * 9 : 0

    const open = price
    const ret = drift + vol * gauss() + shock
    const close = open * (1 + ret)
    const wick = Math.abs(gauss()) * vol * open * 0.8
    const high = Math.max(open, close) + wick * rand()
    const low = Math.min(open, close) - wick * rand()

    const volume = Math.max(1, 90 * (1 + Math.abs(ret) / vol) * (0.6 + rand()))
    // aggressive-buy share tracks the bar's direction, as it does on a tape
    const buyShare = Math.min(0.95, Math.max(0.05, 0.5 + (close - open) / (open * vol) / 6 + gauss() * 0.06))

    price = close
    candles.push({
      openTime: start + i * 60_000,
      closeTime: start + (i + 1) * 60_000 - 1,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume: volume * close,
      takerBuyVolume: volume * buyShare,
      trades: Math.round(volume * 3),
      closed: true,
    })
  }
  return candles
}

const filters: SymbolFilters = {
  symbol: 'TESTUSDT',
  tickSize: 0.01,
  stepSize: 0.001,
  minQty: 0.001,
  minNotional: 5,
  pricePrecision: 2,
  quantityPrecision: 3,
}

console.log('indicators')
{
  const flat = Array.from({ length: 100 }, () => 100)
  check('EMA of a constant series is the constant', Math.abs(ema(flat, 21) - 100) < 1e-9)
  check('RSI of a flat series is neutral', Math.abs(rsi(flat, 14) - 50) < 1e-9)

  const rising = Array.from({ length: 100 }, (_, i) => 100 + i)
  check('RSI of a monotonic rise pins at 100', rsi(rising, 14) > 99.9)

  const candles = synthesiseCandles(300)
  const a = atr(candles, 14)
  check('ATR is positive and finite', Number.isFinite(a) && a > 0, String(a))

  check('tick rounding moves up', roundToTick(100.041, 0.01, 'up') === 100.05)
  check('tick rounding moves down', roundToTick(100.069, 0.01, 'down') === 100.06)
  check('tick rounding is exact at a tick', roundToTick(100.05, 0.01, 'up') === 100.05)
}

console.log('\nfeatures')
{
  const candles = synthesiseCandles(400)
  check('short history returns null', computeFeatures({ symbol: 'T', candles: candles.slice(0, 50), now: 0 }) === null)

  const f = computeFeatures({ symbol: 'T', candles, now: candles.at(-1)!.closeTime })
  check('features computed from 400 bars', f !== null)
  if (f) {
    // msToFunding is deliberately Infinity when no mark stream has arrived
    const finite = Object.entries(f).filter(
      ([k, v]) => k !== 'msToFunding' && typeof v === 'number' && !Number.isFinite(v),
    )
    check('every numeric field is finite', finite.length === 0, finite.map(([k]) => k).join(', '))
    check('unknown funding time reads as Infinity', f.msToFunding === Infinity)
    check('live flag is false without book/trades', f.live === false)
    check('book and flow read as unavailable, not neutral-positive', f.bookImb5 === 0 && f.flowFast === 0)
    check('ATR percentage is plausible', f.atrPct > 0 && f.atrPct < 0.2, String(f.atrPct))
    check('range position is bounded', f.rangePos >= -0.01 && f.rangePos <= 1.01, String(f.rangePos))
  }
}

console.log('\nbacktest invariants')
{
  const candles = synthesiseCandles(6000, 11)
  const result = backtest({
    symbol: 'TESTUSDT',
    candles,
    filters,
    // relaxed so the synthetic path produces a usable sample of trades
    config: { minScore: 60, symbols: ['TESTUSDT'] },
  })

  check('the engine evaluated bars', result.barsEvaluated > 1000, String(result.barsEvaluated))
  check('signals were produced', result.signals.length > 0, `${result.signals.length} signals`)

  const problems: string[] = []
  const inspect = (s: TrackedSignal, label: string, condition: boolean) => {
    if (!condition) problems.push(`${s.id} ${s.side} ${s.setup}: ${label}`)
  }

  for (const s of result.signals) {
    const d = s.side === 'LONG' ? 1 : -1
    const p = s.plan
    inspect(s, 'stop on the wrong side of entry', d * (p.entry - p.stopLoss) > 0)
    inspect(s, 'TP1 on the wrong side of entry', d * (p.takeProfit1 - p.entry) > 0)
    inspect(s, 'TP2 not beyond TP1', d * (p.takeProfit2 - p.takeProfit1) > 0)
    inspect(s, 'entry zone unordered', p.entryZone[0] <= p.entryZone[1])
    inspect(s, 'entry outside its own zone', p.entry >= p.entryZone[0] - 1e-9 && p.entry <= p.entryZone[1] + 1e-9)
    inspect(s, 'invalidation on the wrong side', d * (p.entry - p.invalidation) > 0)
    inspect(s, 'net R:R below the floor', p.rr1 >= MIN_NET_RR)
    inspect(s, 'TP2 does not improve on TP1', p.rr2 > p.rr1)
    inspect(
      s,
      'break-even win rate inconsistent with R:R',
      Math.abs(p.breakEvenWinRate - 1 / (1 + p.rr1)) < 1e-9,
    )
    inspect(s, 'ETA over budget', p.etaMinutes <= DEFAULT_CONFIG.maxEtaMinutes + 1e-9)
    inspect(s, 'score below threshold', s.score >= 60)
    inspect(s, 'quantity below exchange minimum', p.quantity >= filters.minQty)
    inspect(s, 'prices not on the tick grid', [p.entry, p.stopLoss, p.takeProfit1, p.takeProfit2].every(onTick))
    inspect(s, 'risk distance not positive', p.riskDistance > 0)
    inspect(s, 'unresolved at the end of the replay', s.status !== 'pending' && s.status !== 'active')
    if (s.realisedR !== undefined) {
      inspect(s, 'result worse than -1R before fees is impossible', s.realisedR > -1.6)
      inspect(s, 'hold time over the time stop', (s.holdMs ?? 0) <= (DEFAULT_CONFIG.maxHoldMinutes + 1) * 60_000)
    }
  }
  check('every plan satisfies its invariants', problems.length === 0, problems.slice(0, 5).join(' | '))

  // cooldown must be respected between consecutive signals
  let cooldownBreaches = 0
  for (let i = 1; i < result.signals.length; i++) {
    if (result.signals[i].createdAt - result.signals[i - 1].createdAt < DEFAULT_CONFIG.cooldownMs) cooldownBreaches++
  }
  check('cooldown respected between signals', cooldownBreaches === 0, `${cooldownBreaches} breaches`)

  // overlapping trades on one symbol would double-count risk
  let overlaps = 0
  for (let i = 1; i < result.signals.length; i++) {
    const prev = result.signals[i - 1]
    if ((prev.closedAt ?? 0) > result.signals[i].createdAt) overlaps++
  }
  check('no overlapping positions on one symbol', overlaps === 0, `${overlaps} overlaps`)

  const st = result.stats
  check('stats account for every signal', st.total === result.signals.length)
  check('filled + cancelled covers the book', st.filled + st.cancelled === st.total, `${st.filled}+${st.cancelled} vs ${st.total}`)
  check('win rate is a fraction', st.winRate >= 0 && st.winRate <= 1)

  const summedR = result.signals.reduce((acc, s) => acc + (s.realisedR ?? 0), 0)
  check('total R matches the trade list', Math.abs(summedR - st.totalR) < 1e-9)

  console.log('\nsynthetic replay (random walk — measures wiring, NOT edge):')
  console.log(`  signals ${st.total}  filled ${st.filled}  cancelled ${st.cancelled}`)
  console.log(`  win rate ${(st.winRate * 100).toFixed(1)}%  expectancy ${st.expectancy.toFixed(3)}R  total ${st.totalR.toFixed(1)}R`)
  console.log(`  avg hold ${(st.avgHoldMs / 60_000).toFixed(1)}min  max drawdown ${st.maxDrawdownR.toFixed(1)}R`)
  console.log(`  momentum ${st.bySetup.momentum.filled} trades, reversion ${st.bySetup.reversion.filled} trades`)
  console.log('  top vetoes:')
  for (const [reason, count] of result.vetoes.slice(0, 6)) console.log(`    ${String(count).padStart(6)}  ${reason}`)
}

console.log('\nlook-ahead check')
{
  // A driftless walk has no edge to find. If the replay still prints a healthy
  // positive expectancy, the backtester is peeking at bars it should not see.
  let totalR = 0
  let filled = 0
  for (const seed of [3, 17, 29, 41, 55]) {
    const r = backtest({
      symbol: 'TESTUSDT',
      candles: synthesiseCandles(6000, seed, true),
      filters,
      config: { minScore: 60, symbols: ['TESTUSDT'] },
    })
    totalR += r.stats.totalR
    filled += r.stats.filled
  }
  const expectancy = filled > 0 ? totalR / filled : 0
  console.log(`  ${filled} trades across 5 driftless paths, expectancy ${expectancy.toFixed(3)}R`)
  check('driftless replay produced a sample', filled > 40, `${filled} trades`)
  check(
    'no edge manufactured from a driftless walk',
    expectancy < 0.1,
    `expectancy ${expectancy.toFixed(3)}R — suspect look-ahead`,
  )
}

function onTick(price: number): boolean {
  const units = price / filters.tickSize
  return Math.abs(units - Math.round(units)) < 1e-6
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
