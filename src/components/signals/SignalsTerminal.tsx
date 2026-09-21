import { useEffect, useState } from 'react'
import { useSignalEngine } from '../../hooks/useSignalEngine.ts'
import { Scoreboard } from './Scoreboard.tsx'
import { SettingsPanel } from './SettingsPanel.tsx'
import { SignalCard } from './SignalCard.tsx'
import { Watchlist } from './Watchlist.tsx'
import type { StreamStatus } from '../../signals/stream.ts'

const STATUS_TINT: Record<StreamStatus, string> = {
  idle: 'var(--color-ash)',
  connecting: 'var(--color-sodium)',
  live: 'var(--color-jade)',
  reconnecting: 'var(--color-sodium)',
  stalled: 'var(--color-flare)',
}

export function SignalsTerminal({ onExit }: { onExit?: () => void }) {
  const { signals, open, views, stats, status, statusDetail, error, config, setConfig } = useSignalEngine()
  const [showSettings, setShowSettings] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const priceFor = (symbol: string) => views.find((v) => v.symbol === symbol)?.price ?? 0
  const history = signals.filter((s) => s.status !== 'pending' && s.status !== 'active')

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--color-void)' }}>
      <header
        className="flex h-9 shrink-0 items-center gap-3 overflow-hidden border-b px-3 lg:px-4"
        style={{ borderColor: 'var(--color-rule)', background: 'var(--color-slab)' }}
      >
        <span className="signage shrink-0 text-porcelain">Scalp Desk</span>
        <span className="signage hidden shrink-0 text-ash sm:inline">binance usd-m · 1m</span>

        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: STATUS_TINT[status] }}
            aria-hidden
          />
          <span className="signage" style={{ color: STATUS_TINT[status] }}>
            {status}
          </span>
        </span>
        {statusDetail ? (
          <span className="hidden truncate text-[11px] text-ash lg:inline">{statusDetail}</span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="mono tnum hidden text-[12px] text-ash sm:inline">
            {open.length} live · {stats.filled} resolved
          </span>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="signage border px-2 py-1 text-ash transition-colors hover:text-porcelain"
            style={{ borderColor: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
          >
            settings
          </button>
          {onExit ? (
            <button
              onClick={onExit}
              className="signage border px-2 py-1 text-ash transition-colors hover:text-porcelain"
              style={{ borderColor: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
            >
              fleet
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div
          className="shrink-0 border-b px-3 py-1.5 text-[12px]"
          style={{ borderColor: 'var(--color-rule)', background: 'var(--color-waiting-bg)', color: 'var(--color-flare)' }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          className="hidden w-64 shrink-0 flex-col border-r md:flex"
          style={{ borderColor: 'var(--color-rule)', background: 'var(--color-slab)' }}
        >
          <div className="min-h-0 flex-1 overflow-hidden">
            <Watchlist views={views} minScore={config.minScore} />
          </div>
          <Scoreboard stats={stats} />
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-3 py-3 lg:px-4">
          <section>
            <h2 className="signage mb-2 text-ash">
              live signals {open.length > 0 ? `· ${open.length}` : ''}
            </h2>
            {open.length === 0 ? (
              <EmptyState minScore={config.minScore} watching={config.symbols.length} />
            ) : (
              <div className="space-y-2">
                {open.map((signal) => (
                  <SignalCard
                    key={signal.id}
                    signal={signal}
                    price={priceFor(signal.symbol)}
                    now={now}
                  />
                ))}
              </div>
            )}
          </section>

          {history.length > 0 ? (
            <section className="mt-6">
              <h2 className="signage mb-2 text-ash">resolved · {history.length}</h2>
              <div className="space-y-2">
                {history.slice(0, 40).map((signal) => (
                  <SignalCard key={signal.id} signal={signal} price={priceFor(signal.symbol)} now={now} />
                ))}
              </div>
            </section>
          ) : null}

          <p className="mt-6 max-w-2xl text-[11px] leading-relaxed text-ash">
            Signals are generated from public Binance market data and are informational. Nothing in
            this app connects to an account or places an order. Leveraged perpetual futures can lose
            more than the margin posted; the sizing shown assumes the stop is honoured, and stops can
            slip through in fast markets.
          </p>
        </main>

        {showSettings ? (
          <SettingsPanel config={config} onChange={setConfig} onClose={() => setShowSettings(false)} />
        ) : null}
      </div>

      <div className="md:hidden">
        <Scoreboard stats={stats} />
      </div>
    </div>
  )
}

function EmptyState({ minScore, watching }: { minScore: number; watching: number }) {
  return (
    <div
      className="border px-4 py-6"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-slab)', borderRadius: 'var(--radius-sm)' }}
    >
      <p className="text-[13px] text-porcelain">Nothing qualifies right now.</p>
      <p className="mt-1 max-w-xl text-[12px] text-ash">
        {watching} symbols are being scored on every tick against a {minScore}/100 threshold. The
        watchlist shows each symbol's current score and the specific reason it was passed over —
        quiet volatility and wide spreads are the usual ones, and both are cases where a 1-10 minute
        scalp cannot cover its own costs.
      </p>
    </div>
  )
}
