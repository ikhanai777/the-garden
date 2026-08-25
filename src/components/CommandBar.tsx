import { useEffect, useMemo, useRef, useState } from 'react'
import { fleetEngine } from '../data/mockEngine'
import { STATE_META } from '../data/stateMeta'
import { useAppState } from '../hooks/useAppState'
import { sortByUrgency, useFleet } from '../hooks/useFleet'

interface Command {
  id: string
  label: string
  verb: string
  destructive?: boolean
  run: () => void
}

export function CommandBar() {
  const { commandBarOpen, setCommandBarOpen, select, setReplayTime, setHaltModalOpen } = useAppState()
  const agents = useFleet()
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [armedId, setArmedId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (commandBarOpen) {
      setQuery('')
      setActiveIdx(0)
      setArmedId(null)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [commandBarOpen])

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: 'halt-all',
        label: 'Halt all running agents',
        verb: 'halt',
        destructive: true,
        run: () => setHaltModalOpen(true),
      },
      { id: 'spawn', label: 'Spawn a new agent', verb: 'spawn', run: () => fleetEngine.spawn() },
      {
        id: 'replay-5',
        label: 'Replay from 5 minutes ago',
        verb: 'replay',
        run: () => setReplayTime(Date.now() - 5 * 60_000),
      },
      { id: 'replay-now', label: 'Return to live', verb: 'replay', run: () => setReplayTime(null) },
    ]
    for (const a of sortByUrgency(agents)) {
      cmds.push({
        id: `focus-${a.id}`,
        label: `${a.name} · ${STATE_META[a.state].label}`,
        verb: 'focus',
        run: () => select(a.id),
      })
      if (a.state === 'waiting') {
        cmds.push({
          id: `grant-${a.id}`,
          label: `${a.name} · approve pending request`,
          verb: 'grant',
          run: () => fleetEngine.approve(a.id),
        })
      }
      if (!['complete', 'failed', 'halted'].includes(a.state)) {
        cmds.push({
          id: `halt-${a.id}`,
          label: `${a.name}`,
          verb: 'halt',
          destructive: true,
          run: () => fleetEngine.halt(a.id),
        })
      }
    }
    return cmds
  }, [agents, select, setHaltModalOpen, setReplayTime])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 8)
    return commands
      .filter((c) => `${c.verb} ${c.label}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [commands, query])

  if (!commandBarOpen) return null

  const close = () => {
    setCommandBarOpen(false)
    setArmedId(null)
  }

  const execute = (cmd: Command) => {
    if (cmd.destructive && armedId !== cmd.id) {
      setArmedId(cmd.id)
      return
    }
    cmd.run()
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1))
      setArmedId(null)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
      setArmedId(null)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = filtered[activeIdx]
      if (cmd) execute(cmd)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center"
      style={{ background: 'rgba(10,12,18,0.6)', paddingTop: '15vh' }}
      onClick={close}
    >
      <div
        className="flex h-fit w-[640px] flex-col border"
        style={{
          background: 'var(--color-slab)',
          borderColor: 'var(--color-rule)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIdx(0)
            setArmedId(null)
          }}
          onKeyDown={onKeyDown}
          placeholder="Type a command or agent name…"
          className="body border-b bg-transparent px-4 py-3 text-[15px] text-porcelain outline-none"
          style={{ borderColor: 'var(--color-rule)' }}
        />
        <div className="flex max-h-[360px] flex-col overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-[13px] text-ash">No matches.</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => execute(cmd)}
              className="flex items-center gap-3 px-4 py-2 text-left"
              style={{ background: i === activeIdx ? 'var(--color-selected-bg)' : 'transparent' }}
            >
              <span
                className="signage w-14 shrink-0"
                style={{ color: cmd.destructive ? 'var(--color-flare)' : 'var(--color-ash)' }}
              >
                {cmd.verb}
              </span>
              <span className="body-s text-[13px]" style={{ color: cmd.destructive ? 'var(--color-flare)' : 'var(--color-porcelain)' }}>
                {cmd.label}
              </span>
              {armedId === cmd.id && (
                <span className="mono ml-auto text-[11px] text-flare">⏎ again to confirm</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
