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
  /** Normalised titles of tasks known done; never shrinks, cleared when a new flow starts. */
  doneTitles?: string[]
  /** The watched file the flow was read from; absent for a flow reported through `progress`. */
  source?: string
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  /** The family word read from `model` (`opus`, `sonnet`, ...), '' when none is found. */
  modelFamily?: string
  /** The version read from `model` (`5.5`, `5`), '' for an alias or an unknown id. */
  modelVersion?: string
  /** `model` ends with the `[1m]` long-window suffix. */
  modelLong?: true
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
  /** Why the last failed attempt failed, one sentence, from the worker. */
  failNote?: string
  /** The error line, verbatim, from the worker. */
  failLine?: string
  /** The question the worker is waiting on; its next `step` call without it clears it. */
  blocked?: string
  /** An ended run held in Running, with its done or failed pose, until the user's next prompt. */
  heldDone?: boolean
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
  /** A wakeup's fire time, or a cron's next run: CronCreate's `nextFireAt`, then CronList's at each stop. */
  nextAt?: number
  /** A recurring cron's previous run (its scheduled time), once one has passed; a countdown runs from `lastAt ?? startedAt` to `nextAt`. */
  lastAt?: number
}

/** The main session waiting on the person: the question, when it was asked, and how savvy heard it. */
export type SessionNeed = { text: string; since: number; source: 'ask' | 'tool' }

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  autoOpenedFor: string
}

/** Omarchy colors.toml entries by key; absent keys keep the default colour. */
export type Palette = Partial<Record<'foreground' | 'accent' | 'muted' | 'red' | 'selection' | 'background', string>>

/** skins' published theme (its contract, declared here: savvy reads it without depending on skins); only `dim` (secondary text) is read. */
export type PanelTheme = { mode: 'dark' | 'light'; accent: string; foreground: string; dim: string; red: string; selection: string; background: string }

declare module 'claude-code' {
  interface PluginState {
    skins: { theme: PanelTheme | null }
    clawpit: { takeover: boolean }
    'savvy-progress': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
      theme: Palette | null
      background: BackgroundTask[]
      /** The last /status block: its `STATUS ` line and the first LEFT item, "" when none. */
      status: { header: string; gate: string } | null
      /** The main session's own turn is between a model step and its end (an abort ends it too). */
      mainTurn: boolean
      /** The main session's open question, null when none; set only while the sessionNeed option observes. */
      need?: SessionNeed | null
      /** The validated `stages` entries, "word=phase[+done][+finish]", lower-case. */
      stages: string[]
    }
  }
}
