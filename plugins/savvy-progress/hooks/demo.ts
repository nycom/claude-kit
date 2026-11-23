// `/agents-info demo`: a scripted run that walks the band and the panel through every state they
// draw. A pure function of the elapsed second, so a frame can be redrawn or skipped without drift.
import type { AgentRun, BackgroundTask, Flow, Phase, SessionNeed } from '../types'

export const DEMO_PREFIX = 'demo-'
/** Seconds the script runs (the restore lands on this second); the last frames hold the finished flow. */
export const DEMO_LENGTH = 46

type Cast = {
  id: string
  type: string
  description: string
  model: string
  effort?: string
  from: number
  to: number
  ends?: 'failed'
  round?: number
  tier: string
  notes: string[]
  /** Seconds a failed attempt is reported at (three flag the card); the streak clears at `recover`. */
  fails?: number[]
  recover?: number
  /** A question the worker asks at `ask[0]` and gets answered at `ask[1]`. */
  ask?: [number, number, string]
}

const CAST: Cast[] = [
  { id: 'explore', type: 'Explore', description: 'Map the codebase', model: 'claude-haiku-5-5', from: 1, to: 9, tier: '', notes: ['Scan routes', 'Read components', 'List styles', 'Sum up'] },
  { id: 'plan', type: 'savvy-flow:savvy-fable', description: 'Architecture plan', model: 'claude-fable-5-2', effort: 'high', from: 2, to: 12, tier: 'fable', notes: ['Read the map', 'Pick seams', 'Order tasks', 'Write the plan'] },
  { id: 'hero', type: 'savvy-flow:savvy-heavy', description: 'Hero section implement', model: 'claude-opus-5-5', effort: 'high', from: 5, to: 27, tier: 'heavy', notes: ['Write tests', 'Build layout', 'Wire animation', 'Fix contrast', 'Self-review'] },
  { id: 'review', type: 'savvy-flow:savvy-careful', description: 'API schema review', model: 'claude-opus-5-5', from: 6, to: 22, tier: 'careful', notes: ['Read the diff', 'Check contracts', 'Trace callers', 'Write findings'] },
  { id: 'tests', type: 'savvy-flow:savvy-medium', description: 'Checkout tests', model: 'claude-sonnet-5-5', from: 7, to: 29, tier: 'medium', notes: ['Repro flow', 'Write e2e', 'Run the gate', 'Stabilise', 'Report'], fails: [10, 12, 14], recover: 19 },
  { id: 'design', type: 'savvy-flow:savvy-light', description: 'Landing page design', model: 'claude-haiku-5-5', from: 8, to: 26, tier: 'light', notes: ['Moodboard', 'Type scale', 'Hero comp', 'Hand-off'], ask: [15, 21, 'Dark or light hero for launch day?'] },
  { id: 'copy', type: 'savvy-flow:savvy-medium', description: 'Pricing copy', model: 'claude-sonnet-5-5', from: 13, to: 31, tier: 'medium', notes: ['Read the brief', 'Draft tiers', 'Tighten'] },
  { id: 'docs', type: 'general-purpose', description: 'Release notes docs', model: 'claude-sonnet-5-5', from: 22, to: 31, ends: 'failed', tier: 'light', notes: ['Collect changes', 'Draft notes', 'Link PRs'] },
  // The retry: round 2 of the same task, which lands.
  { id: 'docs-2', type: 'general-purpose', description: 'Release notes docs', model: 'claude-sonnet-5-5', from: 31, to: 37, round: 2, tier: 'light', notes: ['Collect changes', 'Draft notes', 'Link PRs'] },
]

// Per million tokens, rough: a show, not a bill.
const RATE: Record<string, number> = { opus: 12, fable: 20, sonnet: 4, haiku: 1.2 }
const rateOf = (model: string) => Object.entries(RATE).find(([k]) => model.includes(k))?.[1] ?? 4

const PHASE_AT: [number, Phase][] = [[0, 'plan'], [3, 'design'], [6, 'delegate'], [22, 'review'], [32, 'close']]

export const DEMO_QUESTION = 'Ship the launch page to staging now?'
const QUESTION: [number, number] = [23, 28]

/** The show's words: `classic` reads like a real run, `fun` is the same run with sillier labels. */
export type DemoStyle = 'classic' | 'fun'
type Labels = {
  title: string
  question: string
  fail: [note: string, line: string]
  bg: Record<'dev' | 'gate' | 'watch' | 'cron' | 'wake', string>
  /** Per cast id: its description (each keeps its role word, so the costumes stay), step notes, question. */
  cast: Record<string, { description: string; notes: string[]; ask?: string }>
}
const CLASSIC_BG: Labels['bg'] = {
  dev: 'npm run dev -- --port 5173',
  gate: 'npm test -- checkout',
  watch: 'Watch the build log',
  cron: 'Check the launch checklist',
  wake: 'Look at CI on the release PR',
}
const FUN: Labels = {
  title: 'Demo · Operation Crabcake',
  question: 'Deploy on a Friday at 4:59 pm?',
  fail: ['The test passed locally, which is deeply suspicious.', 'Expected: works on my machine · Received: your machine'],
  bg: {
    dev: 'npm run dev -- --pray',
    gate: 'npm test -- --please',
    watch: 'Stare at the build log without blinking',
    cron: 'Check whether prod is still on fire',
    wake: 'Poke CI until it confesses',
  },
  cast: {
    explore: { description: 'Map the haunted codebase', notes: ['Find the exit', 'Read ancient comments', 'Avoid /legacy', 'Count survivors'] },
    plan: { description: 'Architecture plan for world domination', notes: ['Draw boxes', 'Draw arrows', 'Erase arrows', 'Call it hexagonal'] },
    hero: { description: 'Build the crab-powered hero', notes: ['Summon divs', 'Center a div', 'Center it again', 'Blame CSS', 'Ship it'] },
    review: { description: 'Review code nobody admits writing', notes: ['git blame', 'Sigh loudly', 'Leave 47 nits', 'Approve anyway'] },
    tests: { description: 'Tests that only pass on Fridays', notes: ['Write a test', 'Watch it fail', 'Add a retry', 'Add sleep(1000)', 'Call it stable'] },
    design: { description: 'Design a logo, but make it pop', notes: ['Make it pop', 'Make it pop more', 'Try Comic Sans', 'Undo Comic Sans'], ask: 'More gradient, or more sparkle?' },
    copy: { description: 'Pricing copy: free, but premium', notes: ['Add zeros', 'Remove zeros', 'Add "enterprise"'] },
    docs: { description: 'Release notes nobody will read', notes: ['Collect excuses', 'Rename bugs to features', 'Add confetti'] },
  },
}
/** Every question the show can put in the need slot, so a real one is never taken for the show's. */
export const DEMO_QUESTIONS: readonly string[] = [DEMO_QUESTION, FUN.question]

// The cast with a style's words; the round-2 retry shares its task's words.
const castOf = (style: DemoStyle): Cast[] =>
  style === 'classic'
    ? CAST
    : CAST.map(c => {
        const l = FUN.cast[c.id.replace(/-\d+$/, '')]
        return { ...c, description: l.description, notes: l.notes, ask: c.ask && l.ask ? [c.ask[0], c.ask[1], l.ask] : c.ask }
      })

/** The toast wording, from the mod's strings so the show toasts as a real run does, in its language. */
export type DemoWords = { agent: string; failed: (n: number) => string; input: string; finished: string }
const ENGLISH: DemoWords = { agent: 'agent', failed: n => `failed ${n} times`, input: 'needs input', finished: 'Demo flow finished' }

export type DemoFrame = {
  flow: Flow
  agents: AgentRun[]
  background: BackgroundTask[]
  need: SessionNeed | null
  /** Toasts due in this second only. */
  toasts: string[]
}

const runOf = (c: Cast, s: number, t0: number, fail: Labels['fail']): AgentRun => {
  const sec = (n: number) => t0 + n * 1000
  const isOver = s >= c.to
  const span = Math.min(s, c.to) - c.from
  const pct = span / (c.to - c.from)
  const total = c.notes.length
  const failedAttempts = c.fails && s < (c.recover ?? Infinity) ? c.fails.filter(f => s >= f).length : 0
  const tokens = Math.round(span * (c.model.includes('opus') || c.model.includes('fable') ? 21_000 : 13_000))
  const asked = c.ask && s >= c.ask[0] && s < c.ask[1] ? c.ask[2] : undefined
  // A stuck worker's bar stops where it got stuck.
  const stepDone = isOver ? (c.ends ? total - 1 : total) : Math.min(total - 1, Math.floor(pct * total))
  return {
    id: `${DEMO_PREFIX}${c.id}`,
    agentId: `${DEMO_PREFIX}${c.id}`,
    type: c.type,
    description: c.description,
    model: c.model,
    effort: c.effort,
    status: isOver ? (c.ends ?? 'done') : 'running',
    startedAt: sec(c.from),
    endedAt: isOver ? sec(c.to) : undefined,
    contextTokens: Math.min(900_000, Math.round(tokens * 0.6)),
    contextMax: 1_000_000,
    tokens,
    costUsd: (tokens * rateOf(c.model)) / 1e6,
    steps: Math.round(span * 2),
    round: c.round ?? 1,
    stepDone,
    stepTotal: total,
    stepNote: c.notes[Math.min(total - 1, stepDone)],
    ...(failedAttempts ? { failedAttempts, failNote: fail[0], failLine: fail[1] } : {}),
    ...(asked ? { blocked: asked } : {}),
    // Fresh endings stay in Running with their pose; older ones move to Ended.
    ...(isOver && s - c.to < 6 ? { heldDone: true } : {}),
  }
}

export const demoFrame = (s: number, t0: number, w: DemoWords = ENGLISH, style: DemoStyle = 'classic'): DemoFrame => {
  const cast = castOf(style)
  const title = style === 'fun' ? FUN.title : 'Demo · Launch page'
  const question = style === 'fun' ? FUN.question : DEMO_QUESTION
  const fail: Labels['fail'] = style === 'fun' ? FUN.fail : ['The checkout e2e gate is red on the coupon path.', 'expect(total).toBe(90) // received 100']
  const bg = style === 'fun' ? FUN.bg : CLASSIC_BG
  const sec = (n: number) => t0 + n * 1000
  const started = cast.filter(c => s >= c.from)
  const list = started.map(c => runOf(c, s, t0, fail))
  const phase = PHASE_AT.filter(([at]) => s >= at).pop()![1]
  const isFinished = s >= 39
  const tasks = cast.filter(c => c.tier && !c.round).map(c => ({ title: c.description, tier: c.tier, after: c.id === 'copy' ? [1] : [] }))
  const done = tasks.filter(t => list.some(a => a.status === 'done' && a.description === t.title)).length

  const background: BackgroundTask[] = []
  if (s >= 4) background.push({ id: `${DEMO_PREFIX}dev`, kind: 'shell', text: bg.dev, status: 'running', startedAt: sec(4) - 3 * 60_000 })
  if (s >= 9)
    background.push({ id: `${DEMO_PREFIX}gate`, kind: 'shell', text: bg.gate, status: s >= 17 ? 'failed' : 'running', startedAt: sec(9), ...(s >= 17 ? { endedAt: sec(17) } : {}) })
  if (s >= 11) background.push({ id: `${DEMO_PREFIX}watch`, kind: 'monitor', text: bg.watch, status: s >= 34 ? 'done' : 'running', startedAt: sec(11) - 60_000, ...(s >= 34 ? { endedAt: sec(34) } : {}) })
  if (s >= 16) background.push({ id: `${DEMO_PREFIX}cron`, kind: 'cron', text: bg.cron, status: 'scheduled', schedule: 'every 5 minutes', startedAt: sec(16), nextAt: sec(16) + 4 * 60_000 + 30_000 })
  if (s >= 20) background.push({ id: `${DEMO_PREFIX}wake`, kind: 'wakeup', text: bg.wake, status: 'scheduled', startedAt: sec(20), nextAt: sec(20) + 12 * 60_000 })

  const toasts: string[] = []
  for (const c of cast) {
    if (c.fails?.[2] === s) toasts.push(`${w.agent} ${c.description}: ${w.failed(3)}`)
    if (c.ask?.[0] === s) toasts.push(`${w.agent} ${c.description}: ${w.input} — ${c.ask[2]}`)
  }
  if (s === QUESTION[0]) toasts.push(`${w.input} — ${question}`)
  if (s === 39) toasts.push(w.finished)

  return {
    flow: {
      title,
      total: tasks.length,
      done,
      running: list.filter(a => a.status === 'running').length,
      phase: isFinished ? 'close' : phase,
      isFinished,
      tasks,
    },
    agents: list,
    background,
    need: s >= QUESTION[0] && s < QUESTION[1] ? { text: question, since: sec(QUESTION[0]), source: 'tool' } : null,
    toasts,
  }
}
