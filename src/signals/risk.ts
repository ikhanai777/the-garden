/**
 * Turns a candidate into an executable plan: entry band, stop, two targets,
 * size, and an honest estimate of how long it should take.
 *
 * Two rules keep the published numbers from flattering themselves:
 *   - tick rounding always moves targets *away* from entry and stops *toward*
 *     it, so rounding can only ever make a signal harder to win;
 *   - every reward:risk figure is net of round-trip fees and assumed
 *     slippage, and a setup that cannot clear that cost is discarded rather
 *     than published with a thin edge.
 */

import { clamp, lowest, highest, roundToStep, roundToTick } from './indicators.ts'
import { roundTripCostBps } from './config.ts'
import type { EngineConfig } from './config.ts'
import type { Candle, Features, RiskPlan, SetupKind, Side, SymbolFilters } from './types.ts'

export interface PlanInput {
  side: Side
  setup: SetupKind
  features: Features
  candles: Candle[]
  filters: SymbolFilters
  config: EngineConfig
}

export type PlanResult = { plan: RiskPlan } | { rejected: string }

/** Displacement per minute is a fraction of the bar's range — this is the fraction. */
const DIRECTIONAL_EFFICIENCY = 0.55

/**
 * Floor on reward:risk *after* costs. It looks low next to the 2:1 that swing
 * setups quote, and that is the point: on a 1-minute horizon, 8 bps of
 * round-trip friction against a ~25 bps stop is structural, not a rounding
 * error. A 0.6 net R:R needs a 62.5% hit rate to break even — which is the
 * number to judge this engine by, and the number `breakEvenWinRate` publishes
 * on every signal.
 */
export const MIN_NET_RR = 0.6

export function buildPlan(input: PlanInput): PlanResult {
  const { side, setup, features: f, candles, filters, config: cfg } = input
  const d = side === 'LONG' ? 1 : -1
  const tick = filters.tickSize
  const atr = f.atr
  const closedEnd = candles.length - (candles[candles.length - 1].closed ? 0 : 1)

  const raw = setup === 'momentum' ? momentumGeometry(f, d, candles, closedEnd) : reversionGeometry(f, d, candles, closedEnd)

  // stop distance is capped from both sides: too tight and 1m noise takes it,
  // too wide and a 10-minute hold cannot pay for it
  const stopDistance = clamp(d * (raw.entry - raw.stop), 0.45 * atr, 1.4 * atr)
  const entry = roundToTick(raw.entry, tick)
  const stopLoss = roundToTick(entry - d * stopDistance, tick, d > 0 ? 'up' : 'down')
  const riskDistance = Math.abs(entry - stopLoss)
  if (riskDistance < tick) return { rejected: 'stop inside one tick of entry' }

  const tp1 = roundToTick(entry + d * raw.rr1 * riskDistance, tick, d > 0 ? 'up' : 'down')
  const tp2Target = clamp(
    d * (raw.tp2 - entry),
    raw.rr1 * riskDistance * 1.25,
    3 * riskDistance,
  )
  const tp2 = roundToTick(entry + d * tp2Target, tick, d > 0 ? 'up' : 'down')

  const costBps = roundTripCostBps(cfg)
  const riskBps = (riskDistance / entry) * 10_000
  const tp1Bps = (Math.abs(tp1 - entry) / entry) * 10_000
  const tp2Bps = (Math.abs(tp2 - entry) / entry) * 10_000

  if (tp1Bps < costBps * cfg.minEdgeOverFees) {
    return { rejected: `TP1 ${tp1Bps.toFixed(1)}bps does not clear ${cfg.minEdgeOverFees}x costs` }
  }
  const rr1 = (tp1Bps - costBps) / (riskBps + costBps)
  const rr2 = (tp2Bps - costBps) / (riskBps + costBps)
  if (rr1 < MIN_NET_RR) return { rejected: `net R:R ${rr1.toFixed(2)} at TP1, below ${MIN_NET_RR}` }
  // the hit rate this geometry needs just to break even, if every winner
  // stopped at TP1 — published so the score is never read in isolation
  const breakEvenWinRate = 1 / (1 + rr1)

  const etaMinutes = Math.abs(tp1 - entry) / (DIRECTIONAL_EFFICIENCY * atr)
  if (etaMinutes > cfg.maxEtaMinutes) {
    return { rejected: `projected ${etaMinutes.toFixed(1)}min to TP1, over the ${cfg.maxEtaMinutes}min budget` }
  }

  const sizing = sizePosition(entry, riskDistance, filters, cfg)
  if (!sizing) return { rejected: 'position size below the exchange minimum' }

  const zoneLo = roundToTick(Math.min(raw.zone[0], raw.zone[1]), tick, 'down')
  const zoneHi = roundToTick(Math.max(raw.zone[0], raw.zone[1]), tick, 'up')

  return {
    plan: {
      entry,
      entryZone: [zoneLo, zoneHi],
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      riskDistance,
      riskBps,
      rr1,
      rr2,
      breakEvenWinRate,
      etaMinutes,
      invalidation: roundToTick(raw.invalidation, tick),
      ...sizing,
    },
  }
}

interface Geometry {
  entry: number
  zone: [number, number]
  stop: number
  /** reward multiple for TP1, before tick rounding */
  rr1: number
  /** absolute price objective for TP2 */
  tp2: number
  invalidation: number
}

/**
 * Breakout: buy the first shallow pullback into the broken level rather than
 * the print itself, and stop out under the base that produced the break.
 */
function momentumGeometry(f: Features, d: 1 | -1, candles: Candle[], end: number): Geometry {
  const atr = f.atr
  const level = d > 0 ? f.donchianHigh : f.donchianLow
  // never chase: the entry is the better of "small pullback" and the level itself
  const pullback = f.price - d * 0.1 * atr
  const entry = d > 0 ? Math.max(level, Math.min(pullback, f.price)) : Math.min(level, Math.max(pullback, f.price))
  const base = d > 0 ? lowest(candles, 5, end) : highest(candles, 5, end)
  const stop = d > 0 ? Math.min(base - 0.15 * atr, entry - 0.6 * atr) : Math.max(base + 0.15 * atr, entry + 0.6 * atr)
  return {
    entry,
    zone: [entry - d * 0.08 * atr, f.price + d * 0.1 * atr],
    stop,
    rr1: 1.5,
    tp2: entry + d * 2.6 * Math.abs(entry - stop),
    invalidation: level - d * 0.4 * atr,
  }
}

/**
 * Fade: work a limit slightly beyond the current print — the flush usually
 * overshoots once more — and target the mid-band, then VWAP.
 */
function reversionGeometry(f: Features, d: 1 | -1, candles: Candle[], end: number): Geometry {
  const atr = f.atr
  const entry = f.price - d * 0.06 * atr
  const extreme = d > 0 ? lowest(candles, 2, end) : highest(candles, 2, end)
  const stop = d > 0 ? Math.min(extreme, entry - 0.55 * atr) - 0.12 * atr : Math.max(extreme, entry + 0.55 * atr) + 0.12 * atr
  const mid = f.bbMid
  const extended = f.vwap
  // prefer the mid-band as the realistic first objective; VWAP is the stretch goal
  const tp2 = d > 0 ? Math.max(mid, extended) : Math.min(mid, extended)
  return {
    entry,
    zone: [entry - d * 0.3 * atr, f.price + d * 0.05 * atr],
    stop,
    rr1: 1.2,
    tp2,
    invalidation: stop - d * 0.2 * atr,
  }
}

function sizePosition(
  entry: number,
  riskDistance: number,
  filters: SymbolFilters,
  cfg: EngineConfig,
): { quantity: number; notional: number; leverage: number } | null {
  const riskAmount = cfg.equityUsd * cfg.riskPerTrade
  let quantity = riskAmount / riskDistance
  const maxNotional = cfg.equityUsd * cfg.maxLeverage
  if (quantity * entry > maxNotional) quantity = maxNotional / entry
  quantity = roundToStep(quantity, filters.stepSize)
  const notional = quantity * entry
  if (quantity < filters.minQty || notional < filters.minNotional) return null
  return {
    quantity,
    notional,
    leverage: Math.max(1, Math.ceil(notional / cfg.equityUsd)),
  }
}
