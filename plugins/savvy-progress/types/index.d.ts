export type Phase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

export type PlannedTask = {
  title: string
  tier: string
  after: number[]
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  phase: Phase
  isFinished: boolean
  tasks: PlannedTask[]
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  steps: number
  round: number
  /** Self-reported by the worker through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  /** `step` calls with `failed: true`; three or more flag the card. */
  failedAttempts?: number
  /** The question the worker is waiting on; its next `step` call without it clears it. */
  blocked?: string
}

/** Background work that is not a subagent: shells and monitors run, crons and wakeups wait. */
export type BackgroundTask = {
  /** The task id (TaskStop's), the cron id (CronDelete's), or for a ScheduleWakeup `wake:` and its prompt on one line (whitespace collapsed), which the Stop reconcile matches. */
  id: string
  kind: 'shell' | 'monitor' | 'cron' | 'wakeup'
  /** The command, or the description, prompt or reason. */
  text: string
  status: 'running' | 'scheduled' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  /** A cron's schedule: CronCreate's human wording, or the cron expression. */
  schedule?: string
  /** A wakeup's fire time. */
  nextAt?: number
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  autoOpenedFor: string
}

/** Omarchy colors.toml entries by key; absent keys keep the default colour. */
export type Palette = Partial<Record<'foreground' | 'accent' | 'muted' | 'red' | 'selection' | 'background', string>>

/** skins' published theme (its contract, declared here: savvy reads it without depending on skins); `dim` is secondary text, `muted` a border tone. */
export type PanelTheme = { mode: 'dark' | 'light'; accent: string; foreground: string; dim: string; muted: string; red: string; selection: string; background: string }

declare module 'claude-code' {
  interface PluginState {
    skins: { theme: PanelTheme | null }
    'savvy-progress': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
      theme: Palette | null
      background: BackgroundTask[]
    }
  }
}
