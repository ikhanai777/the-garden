# Agentic OS — Dashboard

A supervision console for an OS where autonomous agents run continuously — spawning subtasks, calling tools, spending budget, touching a filesystem, and asking for permission. Built from the design spec in `design/` (see the UI spec shared for this project): the operator's job is to see what every agent is doing right now, and intervene within two seconds.

The fleet, tool calls, and approvals are driven by an in-browser simulation (`src/data/mockEngine.ts`) so the dashboard is fully interactive without a backend.

## Stack

- React 19 + TypeScript, Vite 8
- Tailwind CSS v4 (design tokens in `src/index.css`)
- Framer Motion for the fleet rail's urgency-ordered reflow
- Canvas-rendered "Tide" — the full-bleed seismograph strip at the bottom of the viewport

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Key interactions

- `⌘K` / `Ctrl+K` — command bar (verb-first: halt, spawn, replay, focus, grant)
- `J` / `K` — traverse the fleet by urgency
- `⏎` / `⌫` — approve / deny the selected agent's pending request
- `⌥←` / `⌥→` — scrub the Tide backward/forward; `Esc` returns to live
- Click-drag anywhere in the Tide to scrub the whole dashboard to that instant
- `⌘\` — collapse/expand the context dock
