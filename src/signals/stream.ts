/**
 * Live market data over Binance's combined WebSocket stream.
 *
 * One socket carries every symbol. It auto-reconnects with backoff, and treats
 * silence as failure — a socket that stops delivering is worse than one that
 * closes, because the engine would happily keep scoring stale data.
 */

import { BINANCE } from './config.ts'
import type { BookTop, Candle, DepthLevels, MarkInfo, TradeTick } from './types.ts'

export type StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'stalled'

export interface StreamHandlers {
  onTrade?: (symbol: string, trade: TradeTick) => void
  onBook?: (symbol: string, book: BookTop) => void
  onDepth?: (symbol: string, depth: DepthLevels) => void
  onKline?: (symbol: string, candle: Candle) => void
  onMark?: (symbol: string, mark: MarkInfo) => void
  onStatus?: (status: StreamStatus, detail?: string) => void
}

export interface StreamOptions {
  symbols: string[]
  /** subscribe to the 20-level book; costs bandwidth, buys book-imbalance signal */
  depth?: boolean
  handlers: StreamHandlers
}

/** No data at all for this long means the socket is dead even if it says OPEN. */
const STALE_MS = 20_000
/** Binance drops connections at 24h; pre-empt it well before. */
const REFRESH_MS = 20 * 60 * 60 * 1000

interface CombinedMessage {
  stream: string
  data: Record<string, unknown>
}

export class BinanceStream {
  private ws: WebSocket | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private refreshAt = 0
  private attempt = 0
  private closedByUser = false
  private lastMessageAt = 0
  private status: StreamStatus = 'idle'
  /** messages seen in the current second, exposed for the UI's throughput read-out */
  messageCount = 0

  private readonly options: StreamOptions

  constructor(options: StreamOptions) {
    this.options = options
  }

  get connectionStatus(): StreamStatus {
    return this.status
  }

  get msSinceLastMessage(): number {
    return this.lastMessageAt === 0 ? Infinity : Date.now() - this.lastMessageAt
  }

  start(): void {
    this.closedByUser = false
    this.open()
    this.timer ??= setInterval(() => this.watchdog(), 2_000)
  }

  stop(): void {
    this.closedByUser = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.teardown()
    this.setStatus('idle')
  }

  private streamNames(): string[] {
    const names: string[] = []
    for (const symbol of this.options.symbols) {
      const s = symbol.toLowerCase()
      names.push(`${s}@aggTrade`, `${s}@bookTicker`, `${s}@kline_1m`, `${s}@markPrice@1s`)
      if (this.options.depth !== false) names.push(`${s}@depth20@100ms`)
    }
    return names
  }

  private open(): void {
    this.teardown()
    const url = `${BINANCE.ws}?streams=${this.streamNames().join('/')}`
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (err) {
      this.scheduleReconnect(err instanceof Error ? err.message : String(err))
      return
    }
    this.ws = ws
    this.refreshAt = Date.now() + REFRESH_MS

    ws.onopen = () => {
      this.attempt = 0
      this.lastMessageAt = Date.now()
      this.setStatus('live')
    }
    ws.onmessage = (event: MessageEvent) => {
      this.lastMessageAt = Date.now()
      this.messageCount++
      if (typeof event.data !== 'string') return
      try {
        this.dispatch(JSON.parse(event.data) as CombinedMessage)
      } catch {
        // a malformed frame is not worth tearing the socket down for
      }
    }
    ws.onerror = () => {
      // onclose always follows; reconnect is handled there
    }
    ws.onclose = (event: CloseEvent) => {
      if (this.closedByUser) return
      this.scheduleReconnect(`socket closed (${event.code})`)
    }
  }

  private dispatch(message: CombinedMessage): void {
    const data = message.data
    if (!data || typeof data !== 'object') return
    const h = this.options.handlers
    const symbol = typeof data.s === 'string' ? data.s : undefined

    switch (data.e) {
      case 'aggTrade': {
        if (!symbol) return
        h.onTrade?.(symbol, {
          ts: Number(data.T),
          price: Number(data.p),
          qty: Number(data.q),
          buyerIsMaker: Boolean(data.m),
        })
        return
      }
      case 'bookTicker': {
        if (!symbol) return
        h.onBook?.(symbol, {
          bid: Number(data.b),
          bidQty: Number(data.B),
          ask: Number(data.a),
          askQty: Number(data.A),
          ts: Number(data.T ?? data.E),
        })
        return
      }
      case 'depthUpdate': {
        if (!symbol) return
        h.onDepth?.(symbol, {
          bids: toLevels(data.b),
          asks: toLevels(data.a),
          ts: Number(data.T ?? data.E),
        })
        return
      }
      case 'kline': {
        if (!symbol) return
        const k = data.k as Record<string, unknown>
        h.onKline?.(symbol, {
          openTime: Number(k.t),
          closeTime: Number(k.T),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
          quoteVolume: Number(k.q),
          takerBuyVolume: Number(k.V),
          trades: Number(k.n),
          closed: Boolean(k.x),
        })
        return
      }
      case 'markPriceUpdate': {
        if (!symbol) return
        h.onMark?.(symbol, {
          markPrice: Number(data.p),
          indexPrice: Number(data.i),
          fundingRate: Number(data.r),
          nextFundingTime: Number(data.T),
          ts: Number(data.E),
        })
        return
      }
      default:
        return
    }
  }

  private watchdog(): void {
    if (this.closedByUser || !this.ws) return
    if (Date.now() > this.refreshAt) {
      this.attempt = 0
      this.open()
      return
    }
    if (this.status === 'live' && this.msSinceLastMessage > STALE_MS) {
      this.setStatus('stalled', `no data for ${Math.round(this.msSinceLastMessage / 1000)}s`)
      this.scheduleReconnect('stale socket')
    }
  }

  private scheduleReconnect(detail: string): void {
    this.teardown()
    if (this.closedByUser) return
    this.attempt++
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.attempt - 1, 5)) + Math.random() * 400
    this.setStatus('reconnecting', `${detail} — retry in ${Math.round(delay / 1000)}s`)
    setTimeout(() => {
      if (!this.closedByUser) this.open()
    }, delay)
  }

  private teardown(): void {
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    try {
      ws.close()
    } catch {
      // already closing
    }
  }

  private setStatus(status: StreamStatus, detail?: string): void {
    this.status = status
    this.options.handlers.onStatus?.(status, detail)
  }
}

function toLevels(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return []
  const out: Array<[number, number]> = []
  for (const level of raw) {
    if (!Array.isArray(level)) continue
    out.push([Number(level[0]), Number(level[1])])
  }
  return out
}
