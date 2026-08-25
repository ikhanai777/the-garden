export type AgentState =
  | 'spawning'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'failed'
  | 'complete'
  | 'halted'

export interface Tick {
  t: number // timestamp ms
  /** duration in ms mapped to bar height, log scale. 0/undefined = idle baseline blip */
  duration?: number
  tokenCost?: number
  toolName?: string
  /** marks the tick where a state transition happened, drawn as a break/marker */
  marker?: 'waiting-start' | 'failed' | 'complete' | 'halted' | 'blocked-start' | 'running-start'
}

export interface ToolCall {
  id: string
  timestamp: number
  name: string
  durationMs: number
  tokenCost: number
  paths?: string[]
  output?: string
  failed?: boolean
  error?: string
}

export interface ReasoningTrace {
  id: string
  timestamp: number
  tokenCount: number
  summary: string
}

export interface ApprovalRequest {
  action: string // plain language, active voice
  artifact: string // exact command/diff/request, mono
  scope: string // what else this grants
  requestedAt: number
}

export interface ResourceMeters {
  budgetUsed: number
  budgetTotal: number
  budgetBurnoutAt: number // 0-1 projected position on bar
  contextUsed: number
  contextTotal: number
  contextBurnoutAt: number
  toolCallRate: number // calls/min
  toolCallRateMax: number
  wallClockSpendSec: number
  wallClockBudgetSec: number
}

export interface Agent {
  id: string
  name: string
  state: AgentState
  reason: string
  stateSince: number
  spawnedAt: number
  ticks: Tick[]
  toolCalls: ToolCall[]
  reasoning: ReasoningTrace[]
  files: string[]
  diff: string
  approval?: ApprovalRequest
  meters: ResourceMeters
  writeAccess: string[]
}
