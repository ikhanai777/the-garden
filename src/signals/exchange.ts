/**
 * Binance USDⓈ-M futures REST access.
 *
 * Public market-data endpoints only: no API key, no signing, nothing that can
 * place an order. The browser can call these directly — Binance serves
 * `Access-Control-Allow-Origin: *` on /fapi/v1 market data.
 */

import { BINANCE } from './config.ts'
import type { Candle, MarkInfo, SymbolFilters } from './types.ts'

export class BinanceRestError extends Error {
  readonly status: number
  readonly code?: number

  constructor(message: string, status: number, code?: number) {
    super(message)
    this.name = 'BinanceRestError'
    this.status = status
    this.code = code
  }
}

interface RequestOptions {
  signal?: AbortSignal
  /** retries on 5xx / 429 / network failure, with backoff */
  retries?: number
}

async function get<T>(path: string, params: Record<string, string | number> = {}, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(path, BINANCE.rest)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const retries = opts.retries ?? 3

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(8_000, 400 * 2 ** (attempt - 1)))
    try {
      const res = await fetch(url, { signal: opts.signal, headers: { accept: 'application/json' } })
      if (res.ok) return (await res.json()) as T
      // 418/429 are rate limits, 5xx are transient — both worth a retry
      if (res.status !== 429 && res.status !== 418 && res.status < 500) {
        const body = (await res.json().catch(() => null)) as { code?: number; msg?: string } | null
        throw new BinanceRestError(body?.msg ?? `${res.status} ${res.statusText}`, res.status, body?.code)
      }
      lastError = new BinanceRestError(`${res.status} ${res.statusText}`, res.status)
    } catch (err) {
      if (err instanceof BinanceRestError && err.status < 500 && err.status !== 429) throw err
      if (opts.signal?.aborted) throw err
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type RawKline = [
  openTime: number,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
  closeTime: number,
  quoteVolume: string,
  trades: number,
  takerBuyBase: string,
  takerBuyQuote: string,
  ignore: string,
]

export function parseKline(k: RawKline, closed = true): Candle {
  return {
    openTime: k[0],
    closeTime: k[6],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    quoteVolume: Number(k[7]),
    trades: k[8],
    takerBuyVolume: Number(k[9]),
    closed,
  }
}

export async function fetchKlines(
  symbol: string,
  interval = '1m',
  limit = 500,
  opts: { startTime?: number; endTime?: number; signal?: AbortSignal } = {},
): Promise<Candle[]> {
  const params: Record<string, string | number> = { symbol, interval, limit: Math.min(limit, 1500) }
  if (opts.startTime) params.startTime = opts.startTime
  if (opts.endTime) params.endTime = opts.endTime
  const raw = await get<RawKline[]>('/fapi/v1/klines', params, { signal: opts.signal })
  const candles = raw.map((k) => parseKline(k))
  // the most recent bar is still forming unless its close time is in the past
  const last = candles.at(-1)
  if (last && last.closeTime > Date.now()) last.closed = false
  return candles
}

/**
 * Pulls a contiguous 1m history by walking forward in 1500-bar pages.
 * Used by the backtester; the live engine only needs the last 500.
 */
export async function fetchKlineHistory(
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  onProgress?: (fetched: number) => void,
): Promise<Candle[]> {
  const out: Candle[] = []
  let cursor = startTime
  while (cursor < endTime) {
    const page = await fetchKlines(symbol, interval, 1500, { startTime: cursor, endTime })
    if (page.length === 0) break
    for (const c of page) {
      if (out.length > 0 && c.openTime <= out[out.length - 1].openTime) continue
      out.push(c)
    }
    onProgress?.(out.length)
    const nextCursor = page[page.length - 1].closeTime + 1
    if (nextCursor <= cursor) break
    cursor = nextCursor
    if (page.length < 1500) break
  }
  return out.filter((c) => c.closed || c.closeTime <= Date.now())
}

interface RawExchangeInfo {
  symbols: Array<{
    symbol: string
    status: string
    contractType: string
    quoteAsset: string
    pricePrecision: number
    quantityPrecision: number
    filters: Array<Record<string, string>>
  }>
}

export async function fetchSymbolFilters(signal?: AbortSignal): Promise<Map<string, SymbolFilters>> {
  const info = await get<RawExchangeInfo>('/fapi/v1/exchangeInfo', {}, { signal })
  const map = new Map<string, SymbolFilters>()
  for (const s of info.symbols) {
    if (s.status !== 'TRADING' || s.contractType !== 'PERPETUAL' || s.quoteAsset !== 'USDT') continue
    const price = s.filters.find((f) => f.filterType === 'PRICE_FILTER')
    const lot = s.filters.find((f) => f.filterType === 'LOT_SIZE')
    const notional = s.filters.find((f) => f.filterType === 'MIN_NOTIONAL')
    map.set(s.symbol, {
      symbol: s.symbol,
      tickSize: Number(price?.tickSize ?? 0.01),
      stepSize: Number(lot?.stepSize ?? 0.001),
      minQty: Number(lot?.minQty ?? 0.001),
      minNotional: Number(notional?.notional ?? 5),
      pricePrecision: s.pricePrecision,
      quantityPrecision: s.quantityPrecision,
    })
  }
  return map
}

interface RawTicker {
  symbol: string
  quoteVolume: string
  priceChangePercent: string
  lastPrice: string
}

/** The most liquid perpetuals by 24h quote volume — the only ones worth scalping. */
export async function fetchLiquidSymbols(limit = 20, signal?: AbortSignal): Promise<string[]> {
  const tickers = await get<RawTicker[]>('/fapi/v1/ticker/24hr', {}, { signal })
  return tickers
    .filter((t) => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, limit)
    .map((t) => t.symbol)
}

interface RawPremiumIndex {
  symbol: string
  markPrice: string
  indexPrice: string
  lastFundingRate: string
  nextFundingTime: number
  time: number
}

export async function fetchMarkInfo(symbols: string[], signal?: AbortSignal): Promise<Map<string, MarkInfo>> {
  const raw = await get<RawPremiumIndex | RawPremiumIndex[]>('/fapi/v1/premiumIndex', {}, { signal })
  const list = Array.isArray(raw) ? raw : [raw]
  const wanted = new Set(symbols)
  const out = new Map<string, MarkInfo>()
  for (const r of list) {
    if (!wanted.has(r.symbol)) continue
    out.set(r.symbol, {
      markPrice: Number(r.markPrice),
      indexPrice: Number(r.indexPrice),
      fundingRate: Number(r.lastFundingRate),
      nextFundingTime: r.nextFundingTime,
      ts: r.time,
    })
  }
  return out
}

/** Round-trip latency to the futures API — worth knowing before scalping on it. */
export async function pingLatency(signal?: AbortSignal): Promise<number> {
  const started = performance.now()
  await get('/fapi/v1/time', {}, { signal, retries: 0 })
  return performance.now() - started
}
