/**
 * The decision layer: two playbooks, scored by confluence.
 *
 *   momentum  — a 20-bar range break out of a volatility squeeze, with
 *               aggressive flow and book pressure behind it.
 *   reversion — a stretched flush into the band extreme that is running out of
 *               sellers (or buyers), faded back toward VWAP.
 *
 * Both are expressed as weighted factor lists rather than nested ifs, for two
 * reasons: the published score means something (it is the fraction of
 * available evidence that agrees), and every signal can show its work.
 *
 * Factors marked `gate` are veto rights — zero kills the setup outright.
 * Factors marked `liveOnly` need book/flow data and are dropped from both the
 * numerator and the denominator when replaying klines, so a backtest score is
 * never inflated by evidence it did not have.
 */

import { clamp, ramp } from './indicators.ts'
import type { EngineConfig } from './config.ts'
import type { Factor, Features, SetupKind, Side } from './types.ts'

export interface Candidate {
  side: Side
  setup: SetupKind
  score: number
  factors: Factor[]
  reasons: string[]
}

/** Why a symbol produced nothing — surfaced in the UI so the engine isn't a black box. */
export interface Veto {
  reason: string
}

export type Evaluation = { candidate: Candidate } | { veto: Veto }

export function evaluate(f: Features, cfg: EngineConfig): Evaluation {
  const globalVeto = checkGlobalGates(f, cfg)
  if (globalVeto) return { veto: globalVeto }

  const candidates: Candidate[] = []
  for (const side of ['LONG', 'SHORT'] as const) {
    const d = side === 'LONG' ? 1 : -1
    if (cfg.enableMomentum) {
      const c = build(side, 'momentum', momentumFactors(f, d), f.live)
      if (c) candidates.push(c)
    }
    if (cfg.enableReversion) {
      const c = build(side, 'reversion', reversionFactors(f, d), f.live)
      if (c) candidates.push(c)
    }
  }

  if (candidates.length === 0) return { veto: { reason: 'no setup' } }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (best.score < cfg.minScore) {
    return { veto: { reason: `${best.setup} ${best.side.toLowerCase()} at ${best.score.toFixed(0)}, below ${cfg.minScore}` } }
  }
  return { candidate: best }
}

function checkGlobalGates(f: Features, cfg: EngineConfig): Veto | null {
  if (f.live && f.spreadBps > cfg.maxSpreadBps) {
    return { reason: `spread ${f.spreadBps.toFixed(1)}bps > ${cfg.maxSpreadBps}bps` }
  }
  if (f.atrPct < cfg.minAtrPct) {
    return { reason: `1m ATR ${(f.atrPct * 100).toFixed(3)}% — too quiet to pay fees` }
  }
  if (f.atrPct > cfg.maxAtrPct) {
    return { reason: `1m ATR ${(f.atrPct * 100).toFixed(2)}% — stops would be noise` }
  }
  if (Math.abs(f.fundingRate) > cfg.maxFundingRate) {
    return { reason: `funding ${(f.fundingRate * 100).toFixed(3)}% — positioning too crowded` }
  }
  if (f.msToFunding < cfg.fundingBlackoutMin * 60_000) {
    return { reason: `funding settles in ${Math.round(f.msToFunding / 1000)}s` }
  }
  return null
}

interface Spec {
  key: string
  label: string
  weight: number
  value: number
  gate?: boolean
  liveOnly?: boolean
  detail: string
}

function build(side: Side, setup: SetupKind, specs: Spec[], live: boolean): Candidate | null {
  const factors: Factor[] = []
  let weighted = 0
  let total = 0

  for (const spec of specs) {
    if (spec.liveOnly && !live) continue
    const value = clamp(spec.value, 0, 1)
    if (spec.gate && value <= 0) return null
    factors.push({ ...spec, value })
    weighted += spec.weight * value
    total += spec.weight
  }
  if (total <= 0) return null

  const score = (weighted / total) * 100
  const reasons = factors
    .filter((x) => x.value > 0.3)
    .sort((a, b) => b.weight * b.value - a.weight * a.value)
    .slice(0, 5)
    .map((x) => `${x.label}: ${x.detail}`)

  return { side, setup, score, factors, reasons }
}

/** Range break with the tape behind it. */
function momentumFactors(f: Features, d: 1 | -1): Spec[] {
  const level = d > 0 ? f.donchianHigh : f.donchianLow
  const breakDist = (d * (f.price - level)) / f.atr
  const stretch = d * f.vwapZ
  const rsiDir = d > 0 ? f.rsi7 : 100 - f.rsi7

  return [
    {
      key: 'break',
      label: '20-bar break',
      weight: 18,
      gate: true,
      value: ramp(breakDist, 0.02, 0.4),
      detail: `${breakDist >= 0 ? '+' : ''}${breakDist.toFixed(2)} ATR through ${level.toPrecision(6)}`,
    },
    {
      key: 'trend',
      label: 'trend alignment',
      weight: 14,
      gate: true,
      value: d * (f.price - f.ema50) > 0 ? ramp(d * f.trendSep, 0.03, 0.7) : 0,
      detail: `EMA9−21 ${(d * f.trendSep).toFixed(2)} ATR, price ${d * (f.price - f.ema50) > 0 ? 'above' : 'below'} EMA50`,
    },
    {
      key: 'slope',
      label: 'trend slope',
      weight: 8,
      value: ramp(d * f.trendSlope, 0.005, 0.12),
      detail: `${(d * f.trendSlope * 100).toFixed(1)}% ATR/bar`,
    },
    {
      key: 'expansion',
      label: 'volatility expansion',
      weight: 10,
      value: f.squeezeRelease ? 1 : clamp(1 - Math.abs(f.bbWidthPct - 0.5) * 2, 0, 1),
      detail: f.squeezeRelease
        ? 'squeeze releasing'
        : `band width at ${(f.bbWidthPct * 100).toFixed(0)}th pct`,
    },
    {
      key: 'volume',
      label: 'volume burst',
      weight: 12,
      gate: true,
      value: ramp(f.volRatio, 1.15, 2.6),
      detail: `${f.volRatio.toFixed(2)}x median bar volume`,
    },
    {
      key: 'flowFast',
      label: '15s taker flow',
      weight: 14,
      gate: true,
      liveOnly: true,
      value: ramp(d * f.flowFast, 0.08, 0.5),
      detail: `${(d * f.flowFast * 100).toFixed(0)}% net aggression with the break`,
    },
    {
      key: 'flowSlow',
      label: '60s taker flow',
      weight: 8,
      liveOnly: true,
      value: ramp(d * f.flowSlow, 0, 0.35),
      detail: `${(d * f.flowSlow * 100).toFixed(0)}% net over the minute`,
    },
    {
      key: 'barFlow',
      label: 'bar delta',
      weight: 8,
      value: ramp(d * f.barFlow, 0, 0.3),
      detail: `${(d * f.barFlow * 100).toFixed(0)}% taker imbalance, last 5 bars`,
    },
    {
      key: 'book',
      label: 'book pressure',
      weight: 8,
      liveOnly: true,
      value: ramp(d * f.bookImb5, 0, 0.35),
      detail: `top-5 imbalance ${(d * f.bookImb5 * 100).toFixed(0)}%`,
    },
    {
      key: 'cvd',
      label: 'CVD slope',
      weight: 6,
      value: ramp(d * f.cvdSlope, 0, 0.4),
      detail: `${(d * f.cvdSlope).toFixed(2)} bar-volumes/bar`,
    },
    {
      key: 'room',
      label: 'not extended',
      weight: 10,
      gate: true,
      value: rsiDir > 90 ? 0 : ramp(2.6 - stretch, 0, 1.2),
      detail: `${stretch.toFixed(1)}σ from VWAP, RSI7 ${f.rsi7.toFixed(0)}`,
    },
  ]
}

/** Fade the flush — only where the move is stretched and the aggressor is done. */
function reversionFactors(f: Features, d: 1 | -1): Spec[] {
  const stretch = -d * f.vwapZ
  const band = d > 0 ? f.bbLower : f.bbUpper
  const bandBreak = (d * (band - f.price)) / f.atr
  const rsiExtreme = d > 0 ? f.rsi2 : 100 - f.rsi2
  const wick = d > 0 ? f.lowerWick : f.upperWick
  const flowFlip = d * (f.flowFast - f.flowSlow)
  const roomToVwap = Math.abs(f.vwap - f.price) / f.atr
  const edge = d > 0 ? 1 - f.rangePos : f.rangePos

  return [
    {
      key: 'stretch',
      label: 'VWAP stretch',
      weight: 20,
      gate: true,
      value: ramp(stretch, 1.8, 3.4),
      detail: `${stretch.toFixed(1)}σ ${d > 0 ? 'below' : 'above'} rolling VWAP`,
    },
    {
      key: 'band',
      label: 'band break',
      weight: 12,
      gate: true,
      value: ramp(bandBreak, 0, 0.5),
      detail: `${bandBreak.toFixed(2)} ATR outside the 2σ band`,
    },
    {
      key: 'exhaustion',
      label: 'momentum exhaustion',
      weight: 14,
      gate: true,
      value: ramp(rsiExtreme, 12, 2),
      detail: `RSI2 ${f.rsi2.toFixed(0)}`,
    },
    {
      key: 'regime',
      label: 'no trend to fight',
      weight: 10,
      gate: true,
      // fading a strongly trending market is how reversion books lose
      value: d * f.trendSep < -0.9 || f.adx > 40 ? 0 : ramp(34 - f.adx, 0, 16),
      detail: `ADX ${f.adx.toFixed(0)}, EMA sep ${f.trendSep.toFixed(2)} ATR`,
    },
    {
      key: 'rejection',
      label: 'wick rejection',
      weight: 10,
      value: ramp(wick, 0.3, 0.65),
      detail: `${(wick * 100).toFixed(0)}% ${d > 0 ? 'lower' : 'upper'} wick on the last bar`,
    },
    {
      key: 'flowFlip',
      label: 'flow turning',
      weight: 12,
      liveOnly: true,
      value: ramp(flowFlip, 0.05, 0.45),
      detail: `15s flow ${(flowFlip * 100).toFixed(0)}pts ${d > 0 ? 'above' : 'below'} the 60s baseline`,
    },
    {
      key: 'bookHolding',
      label: 'book holding',
      weight: 8,
      liveOnly: true,
      value: ramp(d * f.bookImb5, -0.3, 0.2),
      detail: `top-5 imbalance ${(d * f.bookImb5 * 100).toFixed(0)}%`,
    },
    {
      key: 'noCascade',
      label: 'no cascade',
      weight: 8,
      gate: true,
      liveOnly: true,
      // a 6x burst in trade rate is a liquidation run; stand aside, don't fade it
      value: f.tradeRate > 6 ? 0 : ramp(4.5 - f.tradeRate, 0, 2.5),
      detail: `trade rate ${f.tradeRate.toFixed(1)}x baseline`,
    },
    {
      key: 'target',
      label: 'room to target',
      weight: 8,
      gate: true,
      value: ramp(roomToVwap, 0.6, 2),
      detail: `${roomToVwap.toFixed(1)} ATR back to VWAP`,
    },
    {
      key: 'edge',
      label: 'at range edge',
      weight: 6,
      value: ramp(edge, 0.78, 0.97),
      detail: `${(edge * 100).toFixed(0)}% of the way to the 20-bar extreme`,
    },
  ]
}
