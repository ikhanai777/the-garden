/**
 * Outcome tracking. Every published signal is followed to a resolution, so the
 * hit rate on screen is measured rather than asserted.
 *
 * Management matches how the setups are meant to be traded: scale out
 * `TP1_FRACTION` at the first target, move the stop to break-even, and let the
 * remainder run to TP2 or the time stop. Results are reported in R — multiples
 * of the risk actually taken at the fill price — net of fees and slippage.
 */

import { roundTripCostBps } from './config.ts'
import type { EngineConfig } from './config.ts'
import type { PerformanceStats, Signal, TrackedSignal } from './types.ts'

export const TP1_FRACTION = 0.6

/**
 * Cap on retained history. A session left running for days would otherwise
 * grow without bound; only resolved signals are dropped, oldest first, so the
 * scoreboard reflects the most recent `MAX_HISTORY` outcomes.
 */
export const MAX_HISTORY = 1000

export interface PriceUpdate {
  symbol: string
  price: number
  now: number
}

export class SignalTracker {
  private readonly signals: TrackedSignal[] = []
  private config: EngineConfig

  constructor(config: EngineConfig) {
    this.config = config
  }

  setConfig(config: EngineConfig): void {
    this.config = config
  }

  add(signal: Signal): TrackedSignal {
    const tracked: TrackedSignal = { ...signal, status: 'pending', maxFavourableR: 0, maxAdverseR: 0 }
    this.signals.unshift(tracked)
    this.trim()
    return tracked
  }

  private trim(): void {
    let excess = this.signals.length - MAX_HISTORY
    for (let i = this.signals.length - 1; i >= 0 && excess > 0; i--) {
      const s = this.signals[i]
      if (s.status === 'pending' || s.status === 'active') continue
      this.signals.splice(i, 1)
      excess--
    }
  }

  get all(): readonly TrackedSignal[] {
    return this.signals
  }

  get open(): TrackedSignal[] {
    return this.signals.filter((s) => s.status === 'pending' || s.status === 'active')
  }

  get closed(): TrackedSignal[] {
    return this.signals.filter((s) => s.status !== 'pending' && s.status !== 'active')
  }

  /** Live (pending or active) signals on a symbol — used for the cooldown check. */
  openFor(symbol: string): TrackedSignal[] {
    return this.open.filter((s) => s.symbol === symbol)
  }

  /**
   * Advances every open signal on the symbol. Returns the ones whose status
   * changed, so callers can notify without diffing the whole list.
   */
  update({ symbol, price, now }: PriceUpdate): TrackedSignal[] {
    const changed: TrackedSignal[] = []
    for (const s of this.signals) {
      if (s.symbol !== symbol) continue
      if (s.status === 'pending') {
        if (this.advancePending(s, price, now)) changed.push(s)
      } else if (s.status === 'active') {
        if (this.advanceActive(s, price, now)) changed.push(s)
      }
    }
    return changed
  }

  private advancePending(s: TrackedSignal, price: number, now: number): boolean {
    const d = s.side === 'LONG' ? 1 : -1
    if (d * (price - s.plan.invalidation) <= 0) {
      s.status = 'cancelled'
      s.closedAt = now
      s.closePrice = price
      return true
    }
    if (now >= s.expiresAt) {
      s.status = 'cancelled'
      s.closedAt = now
      s.closePrice = price
      return true
    }
    const [lo, hi] = s.plan.entryZone
    if (price < lo || price > hi) return false
    s.status = 'active'
    s.filledAt = now
    // fills at the touched price, bounded by the band we published
    s.fillPrice = Math.min(hi, Math.max(lo, price))
    s.unrealisedR = 0
    return true
  }

  private advanceActive(s: TrackedSignal, price: number, now: number): boolean {
    const fill = s.fillPrice ?? s.plan.entry
    const d = s.side === 'LONG' ? 1 : -1
    const risk = Math.abs(fill - s.plan.stopLoss)
    if (risk <= 0) {
      s.status = 'cancelled'
      s.closedAt = now
      return true
    }

    const excursion = (d * (price - fill)) / risk
    s.unrealisedR = excursion - this.feeR(fill, risk)
    s.maxFavourableR = Math.max(s.maxFavourableR ?? 0, excursion)
    s.maxAdverseR = Math.min(s.maxAdverseR ?? 0, excursion)

    const hitTp1 = d * (price - s.plan.takeProfit1) >= 0
    const hitTp2 = d * (price - s.plan.takeProfit2) >= 0
    const stop = s.tp1Hit ? fill : s.plan.stopLoss
    const hitStop = d * (price - stop) <= 0

    if (!s.tp1Hit && hitTp1) {
      s.tp1Hit = true
      if (!hitTp2 && !hitStop) return true
    }

    if (hitTp2 && s.tp1Hit) {
      this.close(s, s.plan.takeProfit2, now, 'tp2')
      return true
    }
    if (hitStop) {
      this.close(s, stop, now, s.tp1Hit ? 'tp1' : 'stopped')
      return true
    }
    if (now - (s.filledAt ?? now) >= this.config.maxHoldMinutes * 60_000) {
      this.close(s, price, now, s.tp1Hit ? 'tp1' : 'timeout')
      return true
    }
    return false
  }

  private close(s: TrackedSignal, exit: number, now: number, status: TrackedSignal['status']): void {
    s.status = status
    s.closedAt = now
    s.closePrice = exit
    s.holdMs = now - (s.filledAt ?? now)
    s.realisedR = settle(s, exit, Boolean(s.tp1Hit), this.config)
    s.unrealisedR = undefined
  }

  private feeR(fill: number, risk: number): number {
    return roundTripFeeR(fill, risk, this.config)
  }

  stats(): PerformanceStats {
    return summarise(this.signals)
  }
}

/**
 * Net result of a closed signal in R. Shared by the live tracker and the
 * backtester so a replayed number and a live number mean the same thing.
 */
export function settle(
  signal: TrackedSignal,
  exit: number,
  tp1Hit: boolean,
  config: EngineConfig,
): number {
  const fill = signal.fillPrice ?? signal.plan.entry
  const d = signal.side === 'LONG' ? 1 : -1
  const risk = Math.abs(fill - signal.plan.stopLoss)
  if (risk <= 0) return 0
  const exitR = (d * (exit - fill)) / risk
  const tp1R = (d * (signal.plan.takeProfit1 - fill)) / risk
  // scaled out at TP1, remainder exited at `exit`
  const gross = tp1Hit ? TP1_FRACTION * tp1R + (1 - TP1_FRACTION) * exitR : exitR
  return gross - roundTripFeeR(fill, risk, config)
}

/** Round-trip cost expressed in R, so it can be subtracted from a result. */
export function roundTripFeeR(fill: number, risk: number, config: EngineConfig): number {
  const costBps = roundTripCostBps(config)
  const riskBps = (risk / fill) * 10_000
  return riskBps > 0 ? costBps / riskBps : 0
}

export function summarise(signals: readonly TrackedSignal[]): PerformanceStats {
  const bySetup: PerformanceStats['bySetup'] = {
    momentum: { filled: 0, wins: 0, totalR: 0 },
    reversion: { filled: 0, wins: 0, totalR: 0 },
  }
  let filled = 0
  let wins = 0
  let losses = 0
  let timeouts = 0
  let cancelled = 0
  let totalR = 0
  let grossWin = 0
  let grossLoss = 0
  let holdSum = 0
  let equity = 0
  let peak = 0
  let maxDrawdownR = 0

  // oldest first, so the equity curve runs in the order the trades resolved
  const resolved = signals
    .filter((s) => s.realisedR !== undefined)
    .slice()
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))

  for (const s of signals) if (s.status === 'cancelled') cancelled++

  for (const s of resolved) {
    const r = s.realisedR ?? 0
    filled++
    totalR += r
    holdSum += s.holdMs ?? 0
    if (r > 0) {
      wins++
      grossWin += r
    } else {
      losses++
      grossLoss += -r
    }
    if (s.status === 'timeout') timeouts++
    const bucket = bySetup[s.setup]
    bucket.filled++
    bucket.totalR += r
    if (r > 0) bucket.wins++

    equity += r
    peak = Math.max(peak, equity)
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity)
  }

  return {
    total: signals.length,
    filled,
    wins,
    losses,
    timeouts,
    cancelled,
    winRate: filled > 0 ? wins / filled : 0,
    expectancy: filled > 0 ? totalR / filled : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    totalR,
    maxDrawdownR,
    avgHoldMs: filled > 0 ? holdSum / filled : 0,
    bySetup,
  }
}
