import type { Agent } from '../types'

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  text: string
}

const SAMPLE_ADD = [
  '  const session = await store.get(token)',
  "  if (!session) throw new AuthError('expired')",
  '  return session.userId',
  '  await queue.enqueue(job, { retries: 3 })',
  '  logger.info("checkpoint reached", { id })',
]

const SAMPLE_DEL = [
  '  const session = store.getSync(token)',
  '  return session ? session.userId : null',
  '  queue.push(job)',
  '  console.log("checkpoint", id)',
]

const SAMPLE_CTX = [
  'export async function resolveSession(token: string) {',
  '}',
  '',
  'import { store } from "./store"',
  'import { queue } from "../lib/queue"',
]

export function mockDiff(agent: Agent): DiffLine[] {
  const path = agent.files[0] ?? 'src/index.ts'
  const lines: DiffLine[] = [{ kind: 'ctx', text: `--- ${path}` }, { kind: 'ctx', text: `+++ ${path}` }]
  const seed = agent.id.length + agent.name.length
  const count = 6 + (seed % 5)
  for (let i = 0; i < count; i++) {
    const r = (seed * (i + 3)) % 5
    if (r < 2) lines.push({ kind: 'add', text: SAMPLE_ADD[(i + seed) % SAMPLE_ADD.length] })
    else if (r < 3) lines.push({ kind: 'del', text: SAMPLE_DEL[(i + seed) % SAMPLE_DEL.length] })
    else lines.push({ kind: 'ctx', text: SAMPLE_CTX[(i + seed) % SAMPLE_CTX.length] })
  }
  return lines
}
