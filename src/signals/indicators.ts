/**
 * Indicator primitives. Pure, allocation-light, and written to be called on
 * every book update without showing up in a profile: each one walks a bounded
 * tail of the series rather than the whole history.
 */

import type { Candle } from './types.ts'

export function sma(values: number[], period: number, end = values.length): number {
  const start = end - period
  if (start < 0) return NaN
  let sum = 0
  for (let i = start; i < end; i++) sum += values[i]
  return sum / period
}

/**
 * Exponential moving average of the last `period * 4` samples (enough for the
 * seed to decay below a tick) rather than the full series.
 */
export function ema(values: number[], period: number, end = values.length): number {
  const lookback = Math.min(end, period * 4)
  if (lookback < period) return NaN
  const start = end - lookback
  const k = 2 / (period + 1)
  let acc = sma(values, period, start + period)
  for (let i = start + period; i < end; i++) acc = values[i] * k + acc * (1 - k)
  return acc
}

export function stdev(values: number[], period: number, end = values.length): number {
  const start = end - period
  if (start < 0) return NaN
  const mean = sma(values, period, end)
  let sum = 0
  for (let i = start; i < end; i++) {
    const d = values[i] - mean
    sum += d * d
  }
  return Math.sqrt(sum / period)
}

/** Wilder's RSI over the tail of the series. */
export function rsi(values: number[], period: number, end = values.length): number {
  const lookback = Math.min(end - 1, period * 5)
  if (lookback < period) return NaN
  const start = end - lookback
  let gain = 0
  let loss = 0
  for (let i = start; i < start + period; i++) {
    const d = values[i + 1] - values[i]
    if (d >= 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  for (let i = start + period; i < end - 1; i++) {
    const d = values[i + 1] - values[i]
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
  }
  if (loss === 0) return gain === 0 ? 50 : 100
  const rs = gain / loss
  return 100 - 100 / (1 + rs)
}

export function trueRange(candles: Candle[], i: number): number {
  const c = candles[i]
  if (i === 0) return c.high - c.low
  const prev = candles[i - 1].close
  return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev))
}

/** Wilder's ATR. `end` is exclusive, so pass the forming bar's index to exclude it. */
export function atr(candles: Candle[], period: number, end = candles.length): number {
  const lookback = Math.min(end, period * 5)
  if (lookback < period + 1) return NaN
  const start = end - lookback
  let acc = 0
  for (let i = start + 1; i <= start + period; i++) acc += trueRange(candles, i)
  acc /= period
  for (let i = start + period + 1; i < end; i++) {
    acc = (acc * (period - 1) + trueRange(candles, i)) / period
  }
  return acc
}

/**
 * ADX without the +DI/-DI plumbing exposed — we only use the strength reading
 * to separate "trending" from "chopping" regimes.
 */
export function adx(candles: Candle[], period = 14, end = candles.length): number {
  const lookback = Math.min(end, period * 4)
  if (lookback < period * 2 + 1) return NaN
  const start = end - lookback
  let plus = 0
  let minus = 0
  let tr = 0
  const dxs: number[] = []
  for (let i = start + 1; i < end; i++) {
    const up = candles[i].high - candles[i - 1].high
    const down = candles[i - 1].low - candles[i].low
    const plusDM = up > down && up > 0 ? up : 0
    const minusDM = down > up && down > 0 ? down : 0
    const range = trueRange(candles, i)
    const n = i - start
    if (n <= period) {
      plus += plusDM
      minus += minusDM
      tr += range
      if (n === period && tr > 0) {
        const pdi = (plus / tr) * 100
        const mdi = (minus / tr) * 100
        dxs.push(pdi + mdi === 0 ? 0 : (Math.abs(pdi - mdi) / (pdi + mdi)) * 100)
      }
      continue
    }
    plus = plus - plus / period + plusDM
    minus = minus - minus / period + minusDM
    tr = tr - tr / period + range
    if (tr <= 0) continue
    const pdi = (plus / tr) * 100
    const mdi = (minus / tr) * 100
    dxs.push(pdi + mdi === 0 ? 0 : (Math.abs(pdi - mdi) / (pdi + mdi)) * 100)
  }
  if (dxs.length === 0) return NaN
  const n = Math.min(period, dxs.length)
  let sum = 0
  for (let i = dxs.length - n; i < dxs.length; i++) sum += dxs[i]
  return sum / n
}

/** Least-squares slope per sample over the last `period` points. */
export function linregSlope(values: number[], period: number, end = values.length): number {
  const start = end - period
  if (start < 0) return NaN
  const n = period
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i++) {
    const y = values[start + i]
    sumX += i
    sumY += y
    sumXY += i * y
    sumXX += i * i
  }
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return 0
  return (n * sumXY - sumX * sumY) / denom
}

/** Fraction of the last `period` samples that sit below `value`, 0..1. */
export function percentileRank(values: number[], value: number, period: number, end = values.length): number {
  const start = Math.max(0, end - period)
  const n = end - start
  if (n <= 0) return 0.5
  let below = 0
  for (let i = start; i < end; i++) if (values[i] < value) below++
  return below / n
}

export function median(values: number[], period: number, end = values.length): number {
  const start = Math.max(0, end - period)
  const slice = values.slice(start, end).sort((a, b) => a - b)
  if (slice.length === 0) return NaN
  const mid = slice.length >> 1
  return slice.length % 2 ? slice[mid] : (slice[mid - 1] + slice[mid]) / 2
}

export function highest(candles: Candle[], period: number, end = candles.length): number {
  const start = Math.max(0, end - period)
  let hi = -Infinity
  for (let i = start; i < end; i++) if (candles[i].high > hi) hi = candles[i].high
  return hi
}

export function lowest(candles: Candle[], period: number, end = candles.length): number {
  const start = Math.max(0, end - period)
  let lo = Infinity
  for (let i = start; i < end; i++) if (candles[i].low < lo) lo = candles[i].low
  return lo
}

/** Volume-weighted average price over the last `period` bars. */
export function rollingVwap(candles: Candle[], period: number, end = candles.length): number {
  const start = Math.max(0, end - period)
  let pv = 0
  let vol = 0
  for (let i = start; i < end; i++) {
    const c = candles[i]
    const typical = (c.high + c.low + c.close) / 3
    pv += typical * c.volume
    vol += c.volume
  }
  return vol > 0 ? pv / vol : NaN
}

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}

/** Maps `value` onto 0..1, saturating outside [lo, hi]. */
export function ramp(value: number, lo: number, hi: number): number {
  if (hi === lo) return value >= hi ? 1 : 0
  return clamp((value - lo) / (hi - lo), 0, 1)
}

export function roundToTick(price: number, tickSize: number, mode: 'nearest' | 'up' | 'down' = 'nearest'): number {
  if (!(tickSize > 0)) return price
  const units = price / tickSize
  const rounded =
    mode === 'up' ? Math.ceil(units - 1e-9) : mode === 'down' ? Math.floor(units + 1e-9) : Math.round(units)
  // tick sizes are decimal (0.01, 0.001…), so re-round to kill float dust
  const decimals = Math.max(0, Math.ceil(-Math.log10(tickSize)) + 1)
  return Number((rounded * tickSize).toFixed(decimals))
}

export function roundToStep(qty: number, stepSize: number): number {
  if (!(stepSize > 0)) return qty
  const decimals = Math.max(0, Math.ceil(-Math.log10(stepSize)) + 1)
  return Number((Math.floor(qty / stepSize + 1e-9) * stepSize).toFixed(decimals))
}
