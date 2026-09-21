import { useState } from 'react'
import type { EngineConfig } from '../../signals/config.ts'

/**
 * The tunables that change what gets published. Raising `minScore` trades
 * frequency for selectivity — it does not make the engine smarter, and the
 * copy here says so rather than implying a dial for "accuracy".
 */
export function SettingsPanel({
  config,
  onChange,
  onClose,
}: {
  config: EngineConfig
  onChange: (patch: Partial<EngineConfig>) => void
  onClose: () => void
}) {
  const [symbolDraft, setSymbolDraft] = useState(config.symbols.join(', '))

  const commitSymbols = () => {
    const symbols = symbolDraft
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    if (symbols.length > 0 && symbols.join() !== config.symbols.join()) onChange({ symbols })
  }

  return (
    <aside
      className="flex w-full max-w-sm min-w-0 flex-col border-l"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-slab)' }}
    >
      <div
        className="flex h-8 shrink-0 items-center justify-between border-b px-3"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <span className="signage text-ash">settings</span>
        <button onClick={onClose} className="signage text-ash hover:text-porcelain">
          close
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <Field label="watchlist" hint="Binance USDⓈ-M perpetuals, comma separated">
          <textarea
            value={symbolDraft}
            onChange={(e) => setSymbolDraft(e.target.value)}
            onBlur={commitSymbols}
            rows={2}
            spellCheck={false}
            className="mono w-full resize-none border px-2 py-1 text-[12px] text-porcelain outline-none"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-void)' }}
          />
        </Field>

        <Slider
          label="minimum score"
          hint="higher publishes fewer, better-corroborated setups"
          value={config.minScore}
          min={50}
          max={95}
          step={1}
          format={(v) => `${v}`}
          onChange={(minScore) => onChange({ minScore })}
        />

        <Slider
          label="max hold"
          hint="hard time stop on every position"
          value={config.maxHoldMinutes}
          min={2}
          max={30}
          step={1}
          format={(v) => `${v}min`}
          onChange={(maxHoldMinutes) => onChange({ maxHoldMinutes })}
        />

        <Slider
          label="max concurrent"
          value={config.maxConcurrent}
          min={1}
          max={8}
          step={1}
          format={(v) => `${v}`}
          onChange={(maxConcurrent) => onChange({ maxConcurrent })}
        />

        <Slider
          label="max spread"
          hint="skip a symbol whose book is too wide to scalp"
          value={config.maxSpreadBps}
          min={1}
          max={15}
          step={0.5}
          format={(v) => `${v}bps`}
          onChange={(maxSpreadBps) => onChange({ maxSpreadBps })}
        />

        <Slider
          label="round-trip fees"
          hint="maker in + taker out is 7bps at standard rates"
          value={config.feeBps}
          min={0}
          max={20}
          step={0.5}
          format={(v) => `${v}bps`}
          onChange={(feeBps) => onChange({ feeBps })}
        />

        <Slider
          label="account equity"
          value={config.equityUsd}
          min={500}
          max={200_000}
          step={500}
          format={(v) => `$${v.toLocaleString()}`}
          onChange={(equityUsd) => onChange({ equityUsd })}
        />

        <Slider
          label="risk per trade"
          hint="distance from entry to stop, as a share of equity"
          value={config.riskPerTrade * 100}
          min={0.1}
          max={3}
          step={0.1}
          format={(v) => `${v.toFixed(1)}%`}
          onChange={(pct) => onChange({ riskPerTrade: pct / 100 })}
        />

        <Field label="playbooks">
          <div className="flex gap-2">
            <Toggle
              label="momentum"
              on={config.enableMomentum}
              onClick={() => onChange({ enableMomentum: !config.enableMomentum })}
            />
            <Toggle
              label="reversion"
              on={config.enableReversion}
              onClick={() => onChange({ enableReversion: !config.enableReversion })}
            />
          </div>
        </Field>

        <p className="border-t pt-3 text-[11px] text-ash" style={{ borderColor: 'var(--color-rule)' }}>
          Settings persist in this browser. They affect which signals are published from here on —
          past results in the scoreboard were measured under the settings in force at the time.
        </p>
      </div>
    </aside>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="signage text-ash">{label}</span>
      {hint ? <span className="mt-0.5 block text-[11px] text-ash">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <Field label={`${label} · ${format(value)}`} hint={hint}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-iris)]"
      />
    </Field>
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="signage border px-2 py-1"
      style={{
        borderColor: on ? 'var(--color-iris)' : 'var(--color-rule)',
        color: on ? 'var(--color-porcelain)' : 'var(--color-ash)',
        background: on ? 'var(--color-selected-bg)' : 'transparent',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {label}
    </button>
  )
}
