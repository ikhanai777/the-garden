/**
 * Replays historical 1m klines through the live decision path — the same
 * `computeFeatures` → `evaluate` → `buildPlan` chain the engine runs — so the
 * measured edge belongs to the strategy and not to a parallel implementation.
 *
 * Three deliberate pessimisms, because a scalper's edge is thin enough that
 * optimistic fills would swamp it:
 *
 *   1. Fills take the worst price inside the published entry band that the bar
 *      actually traded through.
 *   2. When a bar's range contains both the stop and a target, the stop wins.
 *      1m bars cannot resolve the sequence, so the loss is assumed.
 *   3. Fees and slippage are charged on every fill.
 *
 * What it cannot reproduce: order-book imbalance, live taker-flow windows and
 * spread. Those factors are marked `liveOnly` and are dropped from the score's
 * numerator *and* denominator, so a replayed score is computed from the
 * evidence a replay actually has. Live scores see more, and will differ.
 */

import { computeFeatures, MIN_BARS } from './features.ts'
import { buildPlan } from './risk.ts'
import { evaluate } from './strategy.ts'
import { settle, summarise } from './tracker.ts'
import { DEFAULT_CONFIG } from './config.ts'
import type { EngineConfig } from './config.ts'
import type { Candle, PerformanceStats, SymbolFilters, TrackedSignal } from './types.ts'

export interface BacktestInput {
  symbol: string
  candles: Candle[]
  filters: SymbolFilters
  config?: Partial<EngineConfig>
}

export interface BacktestResult {
  symbol: string
  from: number
  to: number
  barsEvaluated: number
  signals: TrackedSignal[]
  stats: PerformanceStats
  /** counts of why bars produced nothing, most common first */
  vetoes: Array<[reason: string, count: number]>
}

const WINDOW = MIN_BARS + 20

export function backtest({ symbol, candles, filters, config }: BacktestInput): BacktestResult {
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...config }
  const bars = candles.filter((c) => c.closed)
  const signals: TrackedSignal[] = []
  const vetoes = new Map<string, number>()
  let barsEvaluated = 0
  let cooldownUntil = 0
  let busyUntilBar = -1

  for (let i = WINDOW; i < bars.length - 1; i++) {
    const bar = bars[i]
    if (i <= busyUntilBar) continue
    if (bar.closeTime < cooldownUntil) continue
    barsEvaluated++

    // the bar under evaluation is presented as still forming, exactly as the
    // live engine sees it a moment before the close
    const window = bars.slice(i - WINDOW, i + 1)
    window[window.length - 1] = { ...bar, closed: false }

    const features = computeFeatures({ symbol, candles: window, now: bar.closeTime })
    if (!features) continue

    const verdict = evaluate(features, cfg)
    if ('veto' in verdict) {
      bump(vetoes, generalise(verdict.veto.reason))
      continue
    }

    const planned = buildPlan({
      side: verdict.candidate.side,
      setup: verdict.candidate.setup,
      features,
      candles: window,
      filters,
      config: cfg,
    })
    if ('rejected' in planned) {
      bump(vetoes, generalise(planned.rejected))
      continue
    }

    const signal: TrackedSignal = {
      id: `${symbol}-${bar.closeTime}`,
      symbol,
      side: verdict.candidate.side,
      setup: verdict.candidate.setup,
      score: verdict.candidate.score,
      createdAt: bar.closeTime,
      expiresAt: bar.closeTime + cfg.entryValiditySec * 1000,
      plan: planned.plan,
      factors: verdict.candidate.factors,
      reasons: verdict.candidate.reasons,
      snapshot: features,
      status: 'pending',
      maxFavourableR: 0,
      maxAdverseR: 0,
    }

    const lastBar = simulate(signal, bars, i, cfg)
    signals.push(signal)
    cooldownUntil = bar.closeTime + cfg.cooldownMs
    busyUntilBar = lastBar
  }

  return {
    symbol,
    from: bars[0]?.openTime ?? 0,
    to: bars.at(-1)?.closeTime ?? 0,
    barsEvaluated,
    signals,
    stats: summarise(signals),
    vetoes: [...vetoes.entries()].sort((a, b) => b[1] - a[1]),
  }
}

/** Walks the signal forward bar by bar. Returns the index where it resolved. */
function simulate(signal: TrackedSignal, bars: Candle[], signalIndex: number, cfg: EngineConfig): number {
  const d = signal.side === 'LONG' ? 1 : -1
  const [zoneLo, zoneHi] = signal.plan.entryZone
  const validBars = Math.max(1, Math.ceil(cfg.entryValiditySec / 60))
  const maxHoldBars = Math.max(1, cfg.maxHoldMinutes)

  let fillIndex = -1
  for (let j = signalIndex + 1; j <= Math.min(signalIndex + validBars, bars.length - 1); j++) {
    const bar = bars[j]
    const touched = bar.low <= zoneHi && bar.high >= zoneLo
    if (touched) {
      // worst price inside the band that this bar actually traded
      const worst = d > 0 ? Math.min(zoneHi, bar.high) : Math.max(zoneLo, bar.low)
      signal.status = 'active'
      signal.filledAt = bar.openTime
      signal.fillPrice = Math.min(zoneHi, Math.max(zoneLo, worst))
      fillIndex = j
      break
    }
    const adverse = d > 0 ? bar.low : bar.high
    if (d * (adverse - signal.plan.invalidation) <= 0) {
      signal.status = 'cancelled'
      signal.closedAt = bar.closeTime
      signal.closePrice = signal.plan.invalidation
      return j
    }
  }

  if (fillIndex < 0) {
    if (signal.status === 'pending') {
      signal.status = 'cancelled'
      signal.closedAt = signal.expiresAt
    }
    return signalIndex + validBars
  }

  const fill = signal.fillPrice ?? signal.plan.entry
  const risk = Math.abs(fill - signal.plan.stopLoss)
  let tp1Hit = false

  for (let j = fillIndex; j < bars.length; j++) {
    const bar = bars[j]
    const favourable = d > 0 ? bar.high : bar.low
    const adverse = d > 0 ? bar.low : bar.high
    if (risk > 0) {
      signal.maxFavourableR = Math.max(signal.maxFavourableR ?? 0, (d * (favourable - fill)) / risk)
      signal.maxAdverseR = Math.min(signal.maxAdverseR ?? 0, (d * (adverse - fill)) / risk)
    }

    const stop = tp1Hit ? fill : signal.plan.stopLoss
    const stopHit = d * (adverse - stop) <= 0
    const tp1Reached = d * (favourable - signal.plan.takeProfit1) >= 0
    const tp2Reached = d * (favourable - signal.plan.takeProfit2) >= 0

    // pessimistic ordering: an ambiguous bar is resolved against the position
    if (stopHit) {
      close(signal, stop, bar.closeTime, tp1Hit ? 'tp1' : 'stopped', tp1Hit, cfg)
      return j
    }
    if (tp2Reached && (tp1Hit || tp1Reached)) {
      close(signal, signal.plan.takeProfit2, bar.closeTime, 'tp2', true, cfg)
      return j
    }
    if (tp1Reached) tp1Hit = true

    if (j - fillIndex >= maxHoldBars) {
      close(signal, bar.close, bar.closeTime, tp1Hit ? 'tp1' : 'timeout', tp1Hit, cfg)
      return j
    }
  }

  const final = bars[bars.length - 1]
  close(signal, final.close, final.closeTime, tp1Hit ? 'tp1' : 'timeout', tp1Hit, cfg)
  return bars.length - 1
}

function close(
  signal: TrackedSignal,
  exit: number,
  at: number,
  status: TrackedSignal['status'],
  tp1Hit: boolean,
  cfg: EngineConfig,
): void {
  signal.status = status
  signal.closedAt = at
  signal.closePrice = exit
  signal.tp1Hit = tp1Hit
  signal.holdMs = at - (signal.filledAt ?? at)
  signal.realisedR = settle(signal, exit, tp1Hit, cfg)
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** Collapses reasons that carry live numbers so the veto histogram is readable. */
function generalise(reason: string): string {
  return reason
    .replace(/-?\d+(\.\d+)?/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
}
