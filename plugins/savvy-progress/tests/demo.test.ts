import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import { DEMO_LENGTH, DEMO_QUESTION, demoFrame } from '../hooks/demo'
import type { AgentRun, BackgroundTask, Flow, SessionNeed } from '../types'
import { bash, PROPS, setup, spawn, T0 } from './drawing'
import type { $T } from './drawing'

let seen: unknown = undefined
const READER: Plugin = {
  name: 'reader',
  register(on) {
    on('prompt.submit', async ($, e, next) => {
      if (e.text === 'read flow') $.ui.toast(`atom:${JSON.stringify(await $.state.get({ plugin: 'savvy-progress', key: 'flow' } as never))}`)
      if (e.text === 'read agents') $.ui.toast(`atom:${JSON.stringify(await $.state.get({ plugin: 'savvy-progress', key: 'agents' } as never))}`)
      if (e.text === 'read need') $.ui.toast(`atom:${JSON.stringify(await $.state.get({ plugin: 'savvy-progress', key: 'need' } as never))}`)
      if (e.text === 'read background') $.ui.toast(`atom:${JSON.stringify(await $.state.get({ plugin: 'savvy-progress', key: 'background' } as never))}`)
      return next(e)
    })
  },
}
const atomOf = async <T,>($: $T, key: string): Promise<T> => {
  await $.prompt.submit({ text: `read ${key}`, origin: { kind: 'task-notification' }, wait: false } as never)
  return seen as T
}
const demo = ($: $T, args = 'demo') => $.command.run({ command: 'agents-info', args } as never)

test('the script walks through every state the panel draws', () => {
  const seenAt = (pick: (s: number) => boolean) => Array.from({ length: DEMO_LENGTH + 1 }, (_, s) => s).some(pick)
  const at = (s: number) => demoFrame(s, T0)
  // Every phase, and a finished flow at the end.
  for (const phase of ['plan', 'design', 'delegate', 'review', 'close']) expect(seenAt(s => at(s).flow.phase === phase && !at(s).flow.isFinished)).toBe(true)
  expect(at(DEMO_LENGTH).flow).toMatchObject({ isFinished: true, done: 7, total: 7 })
  // A failed run, then its round 2 that lands.
  expect(at(DEMO_LENGTH).agents.filter(a => a.description === 'Release notes docs').map(a => [a.round, a.status])).toEqual([[1, 'failed'], [2, 'done']])
  // Every savvy tier, Explore and a plain agent; every role costume through the words.
  const types = new Set(at(DEMO_LENGTH).agents.map(a => a.type.replace(/^[^:]*:/, '')))
  expect([...types].sort()).toEqual(['Explore', 'general-purpose', 'savvy-careful', 'savvy-fable', 'savvy-heavy', 'savvy-light', 'savvy-medium'])
  // A planned task waiting, a failed ×3 flag, a question, the session's own need, a held and an ended run, a failed run.
  expect(seenAt(s => at(s).flow.tasks.length > at(s).agents.length)).toBe(true)
  expect(seenAt(s => at(s).agents.some(a => (a.failedAttempts ?? 0) >= 3 && a.status === 'running'))).toBe(true)
  expect(seenAt(s => at(s).agents.some(a => a.blocked))).toBe(true)
  expect(seenAt(s => at(s).need !== null)).toBe(true)
  expect(seenAt(s => at(s).agents.some(a => a.heldDone) && at(s).agents.some(a => a.status === 'done' && !a.heldDone))).toBe(true)
  expect(at(DEMO_LENGTH).agents.some(a => a.status === 'failed')).toBe(true)
  // Every background kind, and a failed and a done row.
  expect(new Set(at(DEMO_LENGTH).background.map(t => t.kind))).toEqual(new Set(['shell', 'monitor', 'cron', 'wakeup']))
  expect(at(DEMO_LENGTH).background.map(t => t.status)).toEqual(expect.arrayContaining(['failed', 'done', 'running', 'scheduled']))
  // The flagged worker recovers: its streak clears before it ends.
  expect(at(20).agents.find(a => a.description === 'Checkout tests')?.failedAttempts).toBeUndefined()
  // Each toast fires on one second only.
  const toasts = Array.from({ length: DEMO_LENGTH + 1 }, (_, s) => at(s).toasts).flat()
  expect(toasts.length).toBe(new Set(toasts).size)
  expect(toasts.length).toBe(4)
})

test('/agents-info demo plays, toasts, and `demo stop` puts back what was there', { plugins: [READER] }, async ($, on) => {
  const clock = setup(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (e.text.startsWith('atom:') ? (seen = (JSON.parse(e.text.slice(5)) as { value?: unknown }).value ?? null) : toasts.push(e.text), { value: undefined }))
  await bash($, 'make real-work')
  const before = await atomOf<BackgroundTask[]>($, 'background')

  expect(await demo($)).toEqual({ text: expect.stringContaining('Demo started') } as never)
  await clock.advance(16_000)
  expect((await atomOf<Flow>($, 'flow')).title).toBe('Demo · Launch page')
  const running = await atomOf<AgentRun[]>($, 'agents')
  expect(running.find(a => a.description === 'Checkout tests')).toMatchObject({ failedAttempts: 3, modelFamily: 'sonnet' })
  expect(running.find(a => a.description === 'Landing page design')?.blocked).toBeTruthy()
  expect(toasts.includes('agent Checkout tests: failed 3 times')).toBe(true)
  // The panel draws the show.
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: PROPS } as never)
  expect(JSON.stringify(await ui.drawn())).toContain('Hero section implement')
  await ui.unmount()

  // Real background work started mid-show shows beside it and survives the stop.
  await bash($, 'make more-real-work')
  await clock.advance(1_000)
  expect((await atomOf<BackgroundTask[]>($, 'background')).map(t => t.text)).toEqual(expect.arrayContaining(['make real-work', 'make more-real-work', 'npm run dev -- --port 5173']))
  expect(await demo($, 'demo stop')).toEqual({ text: expect.stringContaining('Demo stopped') } as never)
  expect(await atomOf($, 'flow')).toBe(null)
  expect(await atomOf($, 'agents')).toEqual([])
  expect((await atomOf<BackgroundTask[]>($, 'background')).map(t => t.text)).toEqual(['make real-work', 'make more-real-work'])
  expect((await atomOf<BackgroundTask[]>($, 'background'))[0]).toEqual(before[0])
  // Stopped means stopped: time passing writes nothing more.
  await clock.advance(5_000)
  expect(await atomOf($, 'agents')).toEqual([])
  expect(await demo($, 'demo stop')).toEqual({ text: 'No demo is running.' } as never)
})

test('the demo ends by itself and restores', { plugins: [READER] }, async ($, on) => {
  const clock = setup(on)
  on('ui.toast', (_$, e) => (e.text.startsWith('atom:') ? (seen = (JSON.parse(e.text.slice(5)) as { value?: unknown }).value ?? null) : undefined, { value: undefined }))
  await demo($)
  // It ends on the second it says it lasts.
  await clock.advance(DEMO_LENGTH * 1000)
  expect(await atomOf($, 'flow')).toBe(null)
  expect(await atomOf($, 'background')).toEqual([])
})

test('the band ✕, a real spawn, and a ■ on a demo row', { plugins: [READER] }, async ($, on) => {
  const clock = setup(on)
  const calls: string[] = []
  on('ui.toast', (_$, e) => (e.text.startsWith('atom:') ? (seen = (JSON.parse(e.text.slice(5)) as { value?: unknown }).value ?? null) : undefined, { value: undefined }))
  on('tool.call', { tool: 'TaskStop' }, (_$, e) => (calls.push(String((e as { task_id?: string }).task_id)), { result: {} }) as never)

  // ■ on a demo shell stops it in the show, with no TaskStop call.
  await demo($)
  await clock.advance(6_000)
  const pane = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: PROPS } as never)
  await $.ui.press({ plugin: 'savvy-progress', key: 'stop-demo-dev' })
  await pane.unmount()
  await clock.advance(2_000)
  expect((await atomOf<BackgroundTask[]>($, 'background')).find(t => t.id === 'demo-dev')?.status).toBe('done')
  expect(calls).toEqual([])

  // The band's ✕ ends the show.
  const band = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'AbovePrompt', props: PROPS } as never)
  await $.ui.press({ plugin: 'savvy-progress', key: 'savvy-dismiss' })
  await band.unmount()
  expect(await atomOf($, 'flow')).toBe(null)

  // A real spawn ends the show before it lands, so only the real agent is listed.
  await demo($)
  await clock.advance(10_000)
  await spawn($, 'Real work')
  const list = await atomOf<AgentRun[]>($, 'agents')
  expect(list.map(a => a.description)).toEqual(['Real work'])
})

const reads = (on: Parameters<Parameters<typeof test>[1]>[1] | any) =>
  on('ui.toast', (_$: unknown, e: { text: string }) => (e.text.startsWith('atom:') ? (seen = (JSON.parse(e.text.slice(5)) as { value?: unknown }).value ?? null) : undefined, { value: undefined }))

test('a demo does not start over a running agent, which then ends normally', { plugins: [READER] }, async ($, on) => {
  setup(on)
  reads(on)
  await spawn($, 'Real work')
  expect(await demo($)).toEqual({ text: 'Agents are running; run the demo again once they end.' } as never)
  expect(await atomOf($, 'flow')).not.toMatchObject({ title: 'Demo · Launch page' })
  expect((await atomOf<AgentRun[]>($, 'agents')).map(a => a.description)).toEqual(['Real work'])
})

test('a spawn racing the start never loses the real agent', { plugins: [READER] }, async ($, on) => {
  const clock = setup(on)
  reads(on)
  await Promise.all([demo($), spawn($, 'Real work')])
  await clock.advance(3_000)
  expect((await atomOf<AgentRun[]>($, 'agents')).map(a => a.description)).toEqual(['Real work'])
  expect((await atomOf<Flow | null>($, 'flow'))?.title).not.toBe('Demo · Launch page')
})

test('a real question stays over the show, and one answered during it is not brought back', { options: { sessionNeed: 'tool' }, plugins: [READER] }, async ($, on) => {
  const clock = setup(on)
  reads(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', blocked: 'Which database?' } as never)
  await demo($)
  await clock.advance(24_000)
  // At 24s the script asks its own question; the real one is still showing.
  expect((await atomOf<SessionNeed>($, 'need')).text).toBe('Which database?')
  // Your next prompt answers it; the show's question takes the slot, and the stop clears that.
  await $.prompt.submit({ text: 'postgres', wait: false, origin: { kind: 'composer' } } as never)
  await clock.advance(1_000)
  expect((await atomOf<SessionNeed>($, 'need')).text).toBe(DEMO_QUESTION)
  await demo($, 'demo stop')
  expect(await atomOf($, 'need')).toBe(null)
})

test('a refused spawn leaves the demo playing', { plugins: [READER] }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  reads(on)
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ deny: 'not allowed' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await demo($)
  await clock.advance(5_000)
  await spawn($, 'Refused work')
  await clock.advance(1_000)
  expect((await atomOf<Flow>($, 'flow')).title).toBe('Demo · Launch page')
})

test('under language ru the show toasts in Russian, as a real run does', { options: { language: 'ru' } }, async ($, on) => {
  const clock = setup(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  await demo($)
  await clock.advance(15_000)
  expect(toasts.some(t => t.includes('Checkout tests') && t.includes('неудач: 3'))).toBe(true)
})

test('demo fun: the same run with other words, every role word kept', () => {
  const classic = demoFrame(DEMO_LENGTH - 1, T0)
  const fun = demoFrame(DEMO_LENGTH - 1, T0, undefined, 'fun')
  expect(fun.flow.title).toBe('Demo · Operation Crabcake')
  // Same timeline: same ids, statuses and counts; only the words change.
  expect(fun.agents.map(a => [a.id, a.status, a.round])).toEqual(classic.agents.map(a => [a.id, a.status, a.round]))
  expect(fun.flow).toMatchObject({ done: classic.flow.done, total: classic.flow.total, isFinished: true })
  for (const [i, a] of fun.agents.entries()) expect(a.description).not.toBe(classic.agents[i].description)
  // Each planned task still names its agents, so the planned group empties as they start.
  for (const t of fun.flow.tasks) expect(fun.agents.some(a => a.description === t.title)).toBe(true)
  // The role costumes come from these words.
  const byId = Object.fromEntries(fun.agents.map(a => [a.id, a.description]))
  expect(byId['demo-hero']).toMatch(/^Build /)
  expect(byId['demo-review']).toMatch(/^Review /)
  expect(byId['demo-tests']).toMatch(/^Tests /)
  expect(byId['demo-design']).toMatch(/^Design /)
  expect(new Set(fun.background.map(t => t.text))).not.toEqual(new Set(classic.background.map(t => t.text)))
})

test('/agents-info demo fun plays and its question clears on stop', { plugins: [READER] }, async ($, on) => {
  const clock = setup(on)
  reads(on)
  expect(await demo($, 'demo fun')).toEqual({ text: expect.stringContaining('Demo started') } as never)
  await clock.advance(24_000)
  expect((await atomOf<Flow>($, 'flow')).title).toBe('Demo · Operation Crabcake')
  expect((await atomOf<SessionNeed>($, 'need')).text).toBe('Deploy on a Friday at 4:59 pm?')
  await demo($, 'demo stop')
  expect(await atomOf($, 'need')).toBe(null)
  expect(await atomOf($, 'flow')).toBe(null)
})

test('while clawpit has taken over, the demo leaves savvy\'s pane shut and names no ✕', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const opens: string[] = []
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', (_$, e) => (opens.push(e.id), { value: { isPlaced: true } }))
  on('state.get', async (_$, e, next) => (e.plugin === 'clawpit' && e.key === 'takeover' ? { value: { value: true, isSet: true } } : next(e)) as never)
  const reply = (await demo($)) as unknown as { text: string }
  expect(reply.text).toBe('Demo started: 46 seconds. Stop it with /agents-info demo stop.')
  await clock.advance(3_000)
  expect(opens).toEqual([])
})

// The host beneath savvy for the tests below: no spawn mock, so each test brings its own.
const bare = (on: any) => {
  const clock = mock.clock(on, { now: T0 })
  reads(on)
  on('ui.render', (h: any, e: any) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  return clock
}
const spawnOf = ($: $T, description: string, subagentType = 'general-purpose') =>
  $.agent.spawn({ tool_use_id: description, prompt: 'P', description, subagentType, provider: 'claude', parentModel: 'x', background: false, fork: false } as never)

test('a demo asked for while a spawn is being listed waits, then refuses: the real agent is never lost', { plugins: [READER] }, async ($, on) => {
  const clock = bare(on)
  // The spawn's read of the agents list is held, so the demo arrives between the spawn's answer and its insert.
  let armed = false
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  let paused!: () => void
  const atPause = new Promise<void>(r => (paused = r))
  on('agent.spawn', () => ((armed = true), { model: 'claude-opus-5-5', agentId: 'w1' }))
  on('state.get', async (_$, e, next) => {
    if (armed && e.plugin === 'savvy-progress' && e.key === 'agents') {
      armed = false
      paused()
      await gate
    }
    return next(e)
  })
  const sp = spawnOf($, 'Real work')
  await atPause
  const asked = demo($)
  release()
  await sp
  expect(await asked).toEqual({ text: 'Agents are running; run the demo again once they end.' } as never)
  await clock.advance(50_000)
  expect((await atomOf<AgentRun[]>($, 'agents')).map(a => a.description)).toEqual(['Real work'])
})

test('a watched plan edited during a demo is the flow after it', { options: { watch: ['plan.md'] }, plugins: [READER] }, async ($, on) => {
  const clock = bare(on)
  on('fs.read', () => ({ value: '# Release prep\n\n- [x] schema\n- [ ] api\n' }))
  on('fs.exists', () => ({ value: false }))
  on('session.cwd', () => ({ value: '/w' }))
  on('tool.call', { tool: ['Edit', 'Write'] }, () => ({ result: 'written' }) as never)
  await demo($)
  await clock.advance(5_000)
  await $.tool.call({ tool: 'Write', file_path: '/w/plan.md', content: 'x' } as never)
  // The show still owns the band until it ends.
  expect((await atomOf<Flow>($, 'flow')).title).toBe('Demo · Launch page')
  await demo($, 'demo stop')
  expect(await atomOf<Flow>($, 'flow')).toMatchObject({ title: 'Release prep', done: 1, total: 2 })
})

test('a savvy worker launched during a demo still moves the faint layer, and only once', { plugins: [READER] }, async ($, on) => {
  const clock = bare(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w1' }))
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  let entered!: () => void
  const inside = new Promise<void>(r => (entered = r))
  on('tool.call', { tool: 'Agent' }, async () => {
    entered()
    await gate
    return { result: {} } as never
  })
  await demo($)
  await clock.advance(3_000)
  const call = $.tool.call({ tool: 'Agent', subagent_type: 'savvy-medium', description: 'x implement', prompt: 'P' } as never)
  await inside
  await spawnOf($, 'x implement', 'savvy-medium')
  expect(await atomOf<Flow>($, 'flow')).toMatchObject({ title: 'savvy-flow', running: 1, phase: 'delegate' })
  release()
  await call
  expect(await atomOf<Flow>($, 'flow')).toMatchObject({ running: 0 })
})

test('stepBrief flow: a spawn during a demo is briefed against the real flow', { options: { stepBrief: 'flow' }, plugins: [READER] }, async ($, on) => {
  const clock = bare(on)
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => (prompts.push(e.prompt), { model: 'claude-opus-5-5', agentId: 'w1' }))
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', total: 1, tasks: [{ title: 'schema', tier: 'medium' }] } as never)
  await demo($)
  await clock.advance(3_000)
  await spawnOf($, 'schema implement')
  expect(prompts[0]).toContain('Progress reporting (optional)')
  expect((await atomOf<Flow>($, 'flow')).title).toBe('Ship it')
})

test('a demo row stopped with ■ stays done from the press, whatever the script does next', { plugins: [READER] }, async ($, on) => {
  const clock = setup(on)
  reads(on)
  await demo($)
  await clock.advance(10_000)
  const pane = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: PROPS } as never)
  await $.ui.press({ plugin: 'savvy-progress', key: 'stop-demo-dev' })
  await $.ui.press({ plugin: 'savvy-progress', key: 'stop-demo-gate' })
  await pane.unmount()
  await clock.advance(1_000)
  const first = await atomOf<BackgroundTask[]>($, 'background')
  // Past the second the script fails the gate.
  await clock.advance(9_000)
  const later = await atomOf<BackgroundTask[]>($, 'background')
  for (const id of ['demo-dev', 'demo-gate']) {
    expect(later.find(t => t.id === id)).toMatchObject({ status: 'done', endedAt: T0 + 10_000 })
    expect(later.find(t => t.id === id)?.endedAt).toBe(first.find(t => t.id === id)?.endedAt)
  }
})

test('a ■ on a demo row after the show ended never sends a real stop', { plugins: [READER] }, async ($, on) => {
  const clock = setup(on)
  reads(on)
  const calls: string[] = []
  on('tool.call', { tool: 'TaskStop' }, (_$, e) => (calls.push(String((e as { task_id?: string }).task_id)), { result: {} }) as never)
  // The row is pressed while its pane still draws it, but the show is already over.
  await demo($)
  await clock.advance(6_000)
  const pane = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: PROPS } as never)
  await demo($, 'demo stop')
  await $.ui.press({ plugin: 'savvy-progress', key: 'stop-demo-dev' }).catch(() => undefined)
  await pane.unmount()
  expect(calls).toEqual([])
})

test('toasts caught up after a late tick come out in script order', async ($, on) => {
  // The demo's 250 ms timer is stretched to 4 s, so the ticks land at 12 s and 16 s: 14 (failed 3 times)
  // and 15 (the design question) are both caught up at 16.
  const slow = ((event: string, ...rest: any[]) => {
    const h = rest.pop()
    return (on as any)(event, ...rest, event === 'clock.every' ? ($$: unknown, e: { ms: number }, ...more: unknown[]) => h($$, e.ms === 250 ? { ...e, ms: 4_000 } : e, ...more) : h)
  }) as any
  const clock = mock.clock(slow, { now: T0 })
  const toasts: string[] = []
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  await demo($)
  await clock.advance(16_000)
  const failed = toasts.findIndex(t => t.includes('failed 3 times'))
  const asked = toasts.findIndex(t => t.includes('More gradient') || t.includes('Dark or light hero'))
  expect(failed).toBeGreaterThanOrEqual(0)
  expect(asked).toBeGreaterThan(failed)
})
