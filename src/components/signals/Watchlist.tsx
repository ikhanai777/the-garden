import { formatBps, formatPct, formatPrice } from '../../signals/format.ts'
import type { SymbolView } from '../../signals/engine.ts'

/**
 * Every watched symbol with its current conviction and, when nothing fired,
 * the specific reason. A scanner that only shows its hits is impossible to
 * trust; this is the part that shows the misses.
 */
export function Watchlist({ views, minScore }: { views: SymbolView[]; minScore: number }) {
  const sorted = [...views].sort((a, b) => b.score - a.score)
  return (
    <div className="flex min-h-0 flex-col">
      <div
        className="flex h-8 shrink-0 items-center justify-between border-b px-3"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <span className="signage text-ash">watchlist</span>
        <span className="signage text-ash">{views.length}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {sorted.map((view) => (
          <li
            key={view.symbol}
            className="border-b px-3 py-2"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="signage text-porcelain">{view.symbol}</span>
              <span className="mono tnum text-[12px] text-porcelain">
                {view.price > 0 ? formatPrice(view.price) : '—'}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="h-1 flex-1"
                style={{ background: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
              >
                <span
                  className="block h-1"
                  style={{
                    width: `${Math.min(100, view.score)}%`,
                    background:
                      view.score >= minScore
                        ? 'var(--color-jade)'
                        : view.score >= minScore * 0.8
                          ? 'var(--color-sodium)'
                          : 'var(--color-iris)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
              </span>
              <span className="mono tnum w-6 text-right text-[11px] text-ash">
                {view.score > 0 ? view.score.toFixed(0) : '–'}
              </span>
            </div>

            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-ash">
                {view.veto ?? `${view.side?.toLowerCase()} ${view.setup} ready`}
              </span>
              <span className="mono tnum shrink-0 text-[11px] text-ash">
                {view.ready ? `${formatPct(view.atrPct, 3)} · ${formatBps(view.spreadBps)}` : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
