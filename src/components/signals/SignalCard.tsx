import { formatAge, formatBps, formatPrice, formatR } from '../../signals/format.ts'
import type { TrackedSignal } from '../../signals/types.ts'

const STATUS_TINT: Record<TrackedSignal['status'], string> = {
  pending: 'var(--color-sodium)',
  active: 'var(--color-iris)',
  tp1: 'var(--color-jade)',
  tp2: 'var(--color-jade)',
  stopped: 'var(--color-flare)',
  timeout: 'var(--color-ash)',
  cancelled: 'var(--color-ash)',
}

const STATUS_LABEL: Record<TrackedSignal['status'], string> = {
  pending: 'awaiting fill',
  active: 'in position',
  tp1: 'closed at TP1',
  tp2: 'closed at TP2',
  stopped: 'stopped out',
  timeout: 'time stop',
  cancelled: 'never filled',
}

/**
 * Where price sits between stop and TP2, 0..1. Drives the ladder marker so the
 * distance left to run is legible without reading the numbers.
 */
function ladderPosition(signal: TrackedSignal, price: number): number {
  const d = signal.side === 'LONG' ? 1 : -1
  const low = signal.plan.stopLoss
  const high = signal.plan.takeProfit2
  const span = d * (high - low)
  if (span <= 0) return 0.5
  return Math.min(1, Math.max(0, (d * (price - low)) / span))
}

export function SignalCard({
  signal,
  price,
  now,
}: {
  signal: TrackedSignal
  price: number
  now: number
}) {
  const { plan, side, status } = signal
  const long = side === 'LONG'
  const tint = STATUS_TINT[status]
  const live = status === 'pending' || status === 'active'
  const reference = live && price > 0 ? price : (signal.closePrice ?? plan.entry)
  const position = ladderPosition(signal, reference)
  const countdown = status === 'pending' ? signal.expiresAt - now : 0

  return (
    <article
      className="border"
      style={{
        borderColor: live ? tint : 'var(--color-rule)',
        background: live ? 'var(--color-selected-bg)' : 'var(--color-slab)',
        borderRadius: 'var(--radius-sm)',
        opacity: live ? 1 : 0.82,
      }}
    >
      <header
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <span
          className="signage px-1.5 py-0.5"
          style={{
            background: long ? 'var(--color-jade)' : 'var(--color-flare)',
            color: 'var(--color-void)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {side}
        </span>
        <span className="signage text-porcelain">{signal.symbol}</span>
        <span className="text-[12px] text-ash">{signal.setup}</span>

        <span className="ml-auto flex items-center gap-2">
          <span className="signage text-ash">score</span>
          <span className="mono tnum text-[13px] text-porcelain">{signal.score.toFixed(0)}</span>
          <span
            className="h-1 w-16"
            style={{ background: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
          >
            <span
              className="block h-1"
              style={{ width: `${signal.score}%`, background: tint, borderRadius: 'var(--radius-sm)' }}
            />
          </span>
        </span>
      </header>

      <div className="px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="signage" style={{ color: tint }}>
            {STATUS_LABEL[status]}
            {status === 'pending' && countdown > 0 ? ` · ${Math.ceil(countdown / 1000)}s` : ''}
          </span>
          <span className="mono tnum text-[12px] text-ash">
            {status === 'active' ? formatR(signal.unrealisedR) : formatR(signal.realisedR)}
            {signal.holdMs ? ` · ${formatAge(signal.holdMs)}` : ''}
          </span>
        </div>

        {/* stop → entry → TP1 → TP2 as one axis, with the live print on it */}
        <div className="relative mt-3 mb-4 h-8">
          <div
            className="absolute top-3 right-0 left-0 h-px"
            style={{ background: 'var(--color-rule)' }}
          />
          <Mark label="SL" value={plan.stopLoss} at={0} tint="var(--color-flare)" />
          <Mark
            label="entry"
            value={plan.entry}
            at={ladderPosition(signal, plan.entry)}
            tint="var(--color-porcelain)"
          />
          <Mark
            label="TP1"
            value={plan.takeProfit1}
            at={ladderPosition(signal, plan.takeProfit1)}
            tint="var(--color-jade)"
          />
          <Mark label="TP2" value={plan.takeProfit2} at={1} tint="var(--color-jade)" />
          {/* live print, sitting on the axis so it never covers the prices */}
          <span
            className="absolute h-[9px] w-0.5"
            style={{
              top: 8,
              left: `${position * 100}%`,
              background: tint,
              boxShadow: `0 0 4px ${tint}`,
              transition: 'left 220ms linear',
            }}
            title={`last ${formatPrice(reference)}`}
          />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
          <Stat label="fill band" value={`${formatPrice(plan.entryZone[0])}–${formatPrice(plan.entryZone[1])}`} />
          <Stat label="risk" value={formatBps(plan.riskBps)} />
          <Stat label="net R:R" value={`${plan.rr1.toFixed(2)} / ${plan.rr2.toFixed(2)}`} />
          <Stat label="eta" value={`${plan.etaMinutes.toFixed(1)}min`} />
          <Stat label="size" value={`${plan.quantity} (${plan.leverage}x)`} />
          <Stat label="breakeven wr" value={`${(plan.breakEvenWinRate * 100).toFixed(0)}%`} />
          {signal.fillPrice ? <Stat label="filled" value={formatPrice(signal.fillPrice)} /> : null}
          {signal.maxFavourableR !== undefined && signal.status !== 'pending' ? (
            <Stat label="best / worst" value={`${signal.maxFavourableR.toFixed(1)} / ${(signal.maxAdverseR ?? 0).toFixed(1)}R`} />
          ) : null}
        </dl>

        {signal.reasons.length > 0 ? (
          <ul className="mt-2 space-y-0.5 border-t pt-2" style={{ borderColor: 'var(--color-rule)' }}>
            {signal.reasons.map((reason) => (
              <li key={reason} className="text-[12px] text-ash">
                · {reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  )
}

function Mark({ label, value, at, tint }: { label: string; value: number; at: number; tint: string }) {
  const clamped = Math.min(1, Math.max(0, at))
  // keep the end labels inside the card rather than clipped at the edges
  const align = clamped <= 0.02 ? 'left' : clamped >= 0.98 ? 'right' : 'center'
  return (
    <span
      className="absolute top-0 flex flex-col items-center"
      style={{
        left: `${clamped * 100}%`,
        transform: align === 'left' ? 'none' : align === 'right' ? 'translateX(-100%)' : 'translateX(-50%)',
      }}
    >
      <span className="mono tnum text-[11px] whitespace-nowrap" style={{ color: tint }}>
        {formatPrice(value)}
      </span>
      <span className="h-2 w-px" style={{ background: tint }} />
      <span className="signage mt-0.5 text-[9px] text-ash">{label}</span>
    </span>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="signage text-[9px] text-ash">{label}</dt>
      <dd className="mono tnum truncate text-[12px] text-porcelain">{value}</dd>
    </div>
  )
}
