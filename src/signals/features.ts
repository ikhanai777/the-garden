/**
 * Turns raw market state into the measured inputs the strategy reads.
 *
 * The same function serves the live engine and the backtester. Live, it gets a
 * book and a trade window; replaying klines it does not, and the fields that
 * need them come back as 0 with `live: false` so the scorer can drop those
 * factors instead of silently treating "no data" as "neutral evidence".
 */

import {
  adx,
  atr,
  ema,
  highest,
  linregSlope,
  lowest,
  median,
  percentileRank,
  rollingVwap,
  rsi,
  sma,
  stdev,
} from './indicators.ts'
import { BAR_MS } from './config.ts'
import type { BookTop, Candle, DepthLevels, Features, MarkInfo, TradeTick } from './types.ts'

export interface MarketInput {
  symbol: string
  /** chronological 1m bars; the last one may still be forming */
  candles: Candle[]
  now: number
  book?: BookTop
  depth?: DepthLevels
  /** recent aggregated trades, ascending by time */
  trades?: TradeTick[]
  mark?: MarkInfo
}

/** Bars needed before the slowest indicator (ema50 over a 4x window) is trustworthy. */
export const MIN_BARS = 210

export function computeFeatures(input: MarketInput): Features | null {
  const { candles, now } = input
  if (candles.length < MIN_BARS) return null

  const last = candles[candles.length - 1]
  const forming = last.closed ? null : last
  /** exclusive end index over *closed* bars — indicators never see a partial bar */
  const end = forming ? candles.length - 1 : candles.length
  if (end < MIN_BARS - 1) return null

  const closes: number[] = []
  const volumes: number[] = []
  for (let i = 0; i < end; i++) {
    closes.push(candles[i].close)
    volumes.push(candles[i].volume)
  }

  const prevClose = closes[closes.length - 1]
  const book = input.book
  const live = Boolean(book && input.trades)
  const price = forming ? forming.close : prevClose
  const mid = book ? (book.bid + book.ask) / 2 : price
  const spreadBps = book && mid > 0 ? ((book.ask - book.bid) / mid) * 10_000 : 0
  const microPrice = book
    ? (book.bid * book.askQty + book.ask * book.bidQty) / Math.max(book.bidQty + book.askQty, 1e-9)
    : price

  const atrValue = atr(candles, 14, end)
  if (!Number.isFinite(atrValue) || atrValue <= 0) return null

  const ema9 = ema(closes, 9)
  const ema21 = ema(closes, 21)
  const ema50 = ema(closes, 50)
  if (!Number.isFinite(ema50)) return null

  // ema21 reconstructed over the last 10 bars so its slope is measurable
  const ema21Series: number[] = []
  for (let i = end - 10; i < end; i++) ema21Series.push(ema(closes, 21, i + 1))
  const trendSlope = linregSlope(ema21Series, ema21Series.length) / atrValue

  const bbMid = sma(closes, 20)
  const bbDev = stdev(closes, 20)
  const bbUpper = bbMid + 2 * bbDev
  const bbLower = bbMid - 2 * bbDev
  const bbWidth = bbMid > 0 ? (bbUpper - bbLower) / bbMid : 0

  // band-width history, for the squeeze percentile
  const widthSeries: number[] = []
  for (let i = end - 100; i < end; i++) {
    if (i < 20) continue
    const m = sma(closes, 20, i + 1)
    const d = stdev(closes, 20, i + 1)
    widthSeries.push(m > 0 ? (4 * d) / m : 0)
  }
  const bbWidthPct = percentileRank(widthSeries, bbWidth, widthSeries.length)
  const prevWidth = widthSeries.at(-2) ?? bbWidth
  const compressedRecently = Math.min(...widthSeries.slice(-6, -1).map((w) => percentileRank(widthSeries, w, widthSeries.length))) <= 0.3
  const squeezeRelease = compressedRecently && bbWidth > prevWidth * 1.05

  const vwap = rollingVwap(candles, 60, end)
  const devSeries: number[] = []
  for (let i = end - 60; i < end; i++) devSeries.push(candles[i].close - rollingVwap(candles, 60, i + 1))
  const devSd = stdev(devSeries, devSeries.length)
  const vwapZ = devSd > 0 ? (price - vwap) / devSd : 0

  const donchianHigh = highest(candles, 20, end)
  const donchianLow = lowest(candles, 20, end)
  const rangePos = donchianHigh > donchianLow ? (price - donchianLow) / (donchianHigh - donchianLow) : 0.5

  const medVolume = median(volumes, 30)
  const elapsed = forming ? Math.min(1, Math.max(0.15, (now - forming.openTime) / BAR_MS)) : 1
  const formingVolume = forming ? forming.volume / elapsed : candles[end - 1].volume
  const volRatio = medVolume > 0 ? formingVolume / medVolume : 1

  // taker imbalance from closed bars: (buy - sell) / total, buy = takerBuyVolume
  let flowVol = 0
  let flowNet = 0
  for (let i = end - 5; i < end; i++) {
    const c = candles[i]
    flowVol += c.volume
    flowNet += 2 * c.takerBuyVolume - c.volume
  }
  const barFlow = flowVol > 0 ? flowNet / flowVol : 0

  const cvd: number[] = []
  let running = 0
  for (let i = end - 30; i < end; i++) {
    running += 2 * candles[i].takerBuyVolume - candles[i].volume
    cvd.push(running)
  }
  const cvdSlope = medVolume > 0 ? linregSlope(cvd, cvd.length) / medVolume : 0

  const lastClosed = candles[end - 1]
  const range = Math.max(lastClosed.high - lastClosed.low, 1e-12)
  const upperWick = (lastClosed.high - Math.max(lastClosed.open, lastClosed.close)) / range
  const lowerWick = (Math.min(lastClosed.open, lastClosed.close) - lastClosed.low) / range
  const bodyRatio = Math.abs(lastClosed.close - lastClosed.open) / range

  const flow = summariseFlow(input.trades ?? [], now)
  const bookImb = summariseDepth(input.depth)

  const mark = input.mark
  const basisBps = mark && price > 0 ? ((mark.markPrice - price) / price) * 10_000 : 0
  const msToFunding = mark?.nextFundingTime ? Math.max(0, mark.nextFundingTime - now) : Infinity

  return {
    symbol: input.symbol,
    ts: now,
    price,
    mid,
    spreadBps,
    microPrice,
    atr: atrValue,
    atrPct: atrValue / price,
    ema9,
    ema21,
    ema50,
    trendSep: (ema9 - ema21) / atrValue,
    trendSlope,
    adx: adx(candles, 14, end),
    rsi7: rsi(closes, 7),
    rsi2: rsi(closes, 2),
    bbUpper,
    bbLower,
    bbMid,
    bbWidth,
    bbWidthPct,
    squeezeRelease,
    vwap,
    vwapZ,
    donchianHigh,
    donchianLow,
    rangePos,
    volRatio,
    barFlow,
    cvdSlope,
    upperWick,
    lowerWick,
    bodyRatio,
    flowFast: flow.fast,
    flowSlow: flow.slow,
    tradeRate: flow.rate,
    bookImb5: bookImb.top5,
    bookImb20: bookImb.top20,
    fundingRate: mark?.fundingRate ?? 0,
    msToFunding,
    basisBps,
    live,
  }
}

interface FlowSummary {
  fast: number
  slow: number
  rate: number
}

/**
 * Aggressive-taker imbalance over two windows. `buyerIsMaker` means the taker
 * was the seller, so the sign is inverted from the flag.
 */
function summariseFlow(trades: TradeTick[], now: number): FlowSummary {
  if (trades.length === 0) return { fast: 0, slow: 0, rate: 1 }
  let fastBuy = 0
  let fastSell = 0
  let slowBuy = 0
  let slowSell = 0
  let fastCount = 0
  let slowCount = 0

  for (let i = trades.length - 1; i >= 0; i--) {
    const t = trades[i]
    const age = now - t.ts
    if (age > 60_000) break
    const notional = t.price * t.qty
    if (t.buyerIsMaker) slowSell += notional
    else slowBuy += notional
    slowCount++
    if (age <= 15_000) {
      if (t.buyerIsMaker) fastSell += notional
      else fastBuy += notional
      fastCount++
    }
  }

  const fastTotal = fastBuy + fastSell
  const slowTotal = slowBuy + slowSell
  // trades/sec over 15s against the 60s baseline
  const baseline = slowCount / 60
  return {
    fast: fastTotal > 0 ? (fastBuy - fastSell) / fastTotal : 0,
    slow: slowTotal > 0 ? (slowBuy - slowSell) / slowTotal : 0,
    rate: baseline > 0 ? fastCount / 15 / baseline : 1,
  }
}

function summariseDepth(depth: DepthLevels | undefined): { top5: number; top20: number } {
  if (!depth || depth.bids.length === 0 || depth.asks.length === 0) return { top5: 0, top20: 0 }
  const value = (levels: Array<[number, number]>, n: number) => {
    let sum = 0
    for (let i = 0; i < Math.min(n, levels.length); i++) sum += levels[i][0] * levels[i][1]
    return sum
  }
  const imb = (n: number) => {
    const b = value(depth.bids, n)
    const a = value(depth.asks, n)
    return b + a > 0 ? (b - a) / (b + a) : 0
  }
  return { top5: imb(5), top20: imb(20) }
}
