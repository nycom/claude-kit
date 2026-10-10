import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

const T0 = Date.UTC(2026, 9, 9, 12, 2, 0)
const PANE = { plugin: 'savvy-progress', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never } as const

const setup = (on: OnT, toasts: string[] = [], opens: string[] = [], calls: Record<string, unknown>[] = []) => {
  const clock = mock.clock(on, { now: T0 })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.open', (_$, e) => (opens.push(e.id), { value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w1' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('classic.Stop', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }))
  on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'm1', timeoutMs: 300000 } }))
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'c1', humanSchedule: 'every 5 minutes', recurring: true } }))
  on('tool.call', { tool: 'ScheduleWakeup' }, (_$, e) =>
    'stop' in e && e.stop
      ? (calls.push(e as never), { result: { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false, stopped: true, cancelledWakeups: 1 } })
      : { result: { scheduledFor: T0 + 720_000, clampedDelaySeconds: 720, wasClamped: false } },
  )
  return clock
}

// Counts clock.now reads: each tick reads it once.
const countTicks = (on: OnT) => {
  const ticks = { n: 0, on }
  ticks.on = ((event: string, ...rest: ((...args: never[]) => unknown)[]) => {
    const handler = rest.pop() as (...args: never[]) => unknown
    const counted = event === 'clock.now' ? (...args: never[]) => (ticks.n++, handler(...args)) : handler
    return (on as (...args: unknown[]) => void)(event, ...rest, counted)
  }) as OnT
  return ticks
}

const bash = ($: $T) => $.tool.call({ tool: 'Bash', command: 'npm run dev -- --port 5173', run_in_background: true } as never)
const notify = ($: $T, id: string, status: string) =>
  $.prompt.submit({
    text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>Background command finished</summary>\n</task-notification>`,
    origin: { kind: 'task-notification' },
    wait: false,
  } as never)

const shown = async ($: $T, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ ...PANE, surface })
  const all = await ui.findAll({})
  const text = all.map(n => `${n.text ?? ''}${(n as { props?: { alt?: string; source?: string } }).props?.alt ?? ''}`).join('|')
  await ui.unmount()
  return text
}

test('a background Bash call adds a shell row; its notification moves it to Ended with its duration', async ($, on) => {
  const clock = setup(on)
  await bash($)
  const live = await shown($)
  expect(live).toContain('Background · 1')
  expect(live).toContain('npm run dev -- --port 5173')
  expect(live).toContain('shell')
  expect(live).not.toContain('Ended')

  await clock.advance(65_000)
  await notify($, 'b1', 'completed')
  const ended = await shown($)
  expect(ended).not.toContain('Background · ')
  expect(ended).toContain('Ended · 1')
  expect(ended).toContain('1:05')
  expect(ended).not.toContain('failed')
})

test('a failed background task shows a red "failed" label in Ended, never the attention chip', async ($, on) => {
  setup(on)
  await bash($)
  await notify($, 'b1', 'failed')
  expect(await shown($)).toContain('failed')
  const desktop = await shown($, 'desktop')
  expect(desktop).toContain('failed')
  const band = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  expect(JSON.stringify(await band.findAll({}))).not.toContain('attention')
  await band.unmount()
})

test('Monitor, CronCreate and ScheduleWakeup rows: monitor elapsed, cron schedule, wakeup countdown', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: 'Monitor', description: 'watch the deploy log', timeout_ms: 300000, command: 'tail -f deploy.log' } as never)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'check the deploy' } as never)
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 720, reason: 'wait for CI', prompt: '/loop check CI' } as never)
  const text = await shown($)
  expect(text).toContain('Background · 3')
  expect(text).toContain('watch the deploy log')
  expect(text).toContain('monitor')
  expect(text).toContain('check the deploy')
  expect(text).toContain('every 5 minutes')
  expect(text).toContain('wait for CI')
  expect(text).toContain('next in 12m')
  // Desktop draws the same rows.
  const desktop = await shown($, 'desktop')
  expect(desktop).toContain('watch the deploy log')
  expect(desktop).toContain('next in 12m')
})

test('Stop: TaskStop for a shell, CronDelete for a cron, ScheduleWakeup stop for a wakeup; one press each', async ($, on) => {
  const calls: Record<string, unknown>[] = []
  setup(on, [], [], calls)
  on('tool.call', { tool: 'TaskStop' }, (_$, e) => (calls.push(e as never), { result: { message: 'stopped', task_id: 'b1', task_type: 'local_bash' } }))
  on('tool.call', { tool: 'CronDelete' }, (_$, e) => (calls.push(e as never), { result: { id: 'c1' } }))
  await bash($)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'check the deploy' } as never)
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 720, reason: 'wait for CI', prompt: '/loop check CI' } as never)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.findAll({ type: 'Button', text: '■' })).length).toBe(3)
  await term.unmount()
  // The desktop's Stops are Client regions (controls.tsx).
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(((await desk.findAll({ type: 'Client' })) as unknown as { props: { props: { label: string } } }[]).filter(n => n.props.props.label === '■').length).toBe(3)
  await desk.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'savvy-progress', key: 'stop-b1' })
  await $.ui.press({ plugin: 'savvy-progress', key: 'stop-c1' })
  await $.ui.press({ plugin: 'savvy-progress', key: 'stop-wake:/loop check CI' })
  await ui.unmount()

  expect(calls[0]).toMatchObject({ tool: 'TaskStop', task_id: 'b1' })
  expect(String(calls[0]?.consent)).toContain('pressed Stop')
  expect(calls[1]).toMatchObject({ tool: 'CronDelete', id: 'c1' })
  expect(calls[2]).toMatchObject({ tool: 'ScheduleWakeup', stop: true })
  expect(calls.length).toBe(3)
  const text = await shown($)
  expect(text).not.toContain('Background · ')
  expect(text).toContain('Ended · 3')
})

test('a Stop that errors toasts the error and keeps the row', async ($, on) => {
  const toasts: string[] = []
  setup(on, toasts)
  // The engine answers a tool's error as an errored result.
  on('tool.call', { tool: 'TaskStop' }, () => ({ isError: true, result: 'No task found with ID: b1', text: 'No task found with ID: b1' }) as never)
  await bash($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'savvy-progress', key: 'stop-b1' })
  await ui.unmount()
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('No task found with ID: b1')
  expect(await shown($)).toContain('Background · 1')
})

test('the Stop hook reconciles: adds a missed task and cron, finishes a vanished one', async ($, on) => {
  setup(on)
  await bash($)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'b9', type: 'shell', status: 'running', description: 'npm test', command: 'npm test --watch' },
      { id: 'a1', type: 'subagent', status: 'running', description: 'an agent' },
    ],
    session_crons: [{ id: 'c7', schedule: '*/5 * * * *', recurring: true, prompt: 'poll the queue' }],
  })
  const text = await shown($)
  expect(text).toContain('Background · 2')
  expect(text).toContain('npm test --watch')
  expect(text).toContain('poll the queue')
  expect(text).toContain('*/5 * * * *')
  expect(text).not.toContain('an agent')
  expect(text).toContain('Ended · 1')
})

test('a background task never opens the pane; a subagent still does', async ($, on) => {
  const opens: string[] = []
  setup(on, [], opens)
  await bash($)
  await $.tool.call({ tool: 'Monitor', description: 'watch', timeout_ms: 1000, command: 'true' } as never)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'x' } as never)
  expect(opens).toEqual([])
  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'pick db', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  expect(opens).toEqual(['savvy-agents'])
})

test('a failed notification after the Stop reconcile ended the task still marks it failed', async ($, on) => {
  setup(on)
  await bash($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  expect(await shown($)).not.toContain('failed')
  await notify($, 'b1', 'failed')
  expect(await shown($)).toContain('failed')
})

test('a ScheduleWakeup that could not arm (scheduledFor 0) adds no row', async ($, on) => {
  mock.clock(on, { now: T0 })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('tool.call', { tool: 'ScheduleWakeup' }, () => ({ result: { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false } }))
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 720, reason: 'wait for CI', prompt: '/loop check CI' } as never)
  expect(await shown($)).not.toContain('wait for CI')
})

test('a multi-line command shows on one line, started or reconciled', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev\n  --port 5173', run_in_background: true } as never)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'b1', type: 'shell', status: 'running', description: 'dev', command: 'npm run dev' },
      { id: 'b9', type: 'shell', status: 'running', description: 'test', command: 'npm test\n\t--watch' },
    ],
    session_crons: [],
  })
  const text = await shown($)
  expect(text).toContain('npm run dev --port 5173')
  expect(text).toContain('npm test --watch')
})

test('a session start, resume or clear empties the background list; a compaction keeps it', async ($, on) => {
  setup(on)
  await bash($)
  expect(await shown($)).toContain('Background · 1')
  await $.classic.SessionStart({ source: 'compact' })
  expect(await shown($)).toContain('Background · 1')
  await $.classic.SessionStart({ source: 'resume' })
  const text = await shown($)
  expect(text).not.toContain('Background · ')
  expect(text).not.toContain('Ended')
})

test('the clock ticks every second while an agent runs, once a minute while a background row shows a time, not for a cron alone', async ($, on) => {
  const ticks = countTicks(on)
  const clock = setup(ticks.on)
  mock.env(on, { HOME: '/home/k' })
  on('fs.stat', () => { throw new Error('ENOENT') })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('turn.complete', () => ({ text: '' }))
  const minute = async () => {
    ticks.n = 0
    await clock.advance(120_000)
    expect(ticks.n).toBeLessThanOrEqual(2)
    expect(ticks.n).toBeGreaterThan(0)
  }
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)
  // A cron shows its schedule, which no tick changes.
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'check the deploy' } as never)
  ticks.n = 0
  await clock.advance(120_000)
  expect(ticks.n).toBe(0)

  // The cron gone, a running shell alone keeps the minute clock.
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  await bash($)
  await minute()

  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'pick db', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  ticks.n = 0
  await clock.advance(3_000)
  expect(ticks.n).toBe(3)

  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 'w1', agentId: 'w1' } as never)
  await minute()
})

test('a pace check that read the agents before one spawned cannot slow the clock the spawn armed', async ($, on) => {
  const ticks = countTicks(on)
  const clock = setup(ticks.on)
  // Holds the cron's pace check at its read of the agents, until the spawn has had its turn.
  let release = () => {}
  const held = new Promise<void>(r => (release = r))
  let onHeld = () => {}
  const isHeld = new Promise<void>(r => (onHeld = r))
  let isGated = true
  on('state.get', async (_$, e, next) => {
    const value = await next(e)
    if (isGated && (e as { key?: string }).key === 'agents') {
      isGated = false
      onHeld()
      await held
    }
    return value
  })
  const cron = $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'check the deploy' } as never)
  await isHeld
  const spawn = $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'pick db', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  for (let i = 0; i < 500; i++) await Promise.resolve()
  release()
  await Promise.all([cron, spawn])
  ticks.n = 0
  await clock.advance(3_000)
  expect(ticks.n).toBe(3)
})

test('a running shell shows its elapsed time in minutes once past a minute', async ($, on) => {
  const clock = setup(on)
  await bash($)
  await clock.advance(150_000)
  const text = await shown($)
  expect(text).toContain('shell · 2m')
  expect(text).not.toContain('shell · 2:')
})

test('a running shell reads "<1m" in its first minute, then whole minutes rounded down', async ($, on) => {
  const clock = setup(on)
  // An agent's clock ticks every second, so the reading is exact.
  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'pick db', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  await bash($)
  await clock.advance(30_000)
  expect(await shown($)).toContain('shell · <1m')
  await clock.advance(60_000)
  expect(await shown($)).toContain('shell · 1m')
})

test('a wakeup whose prompt the engine clipped to 1000 chars still matches its row at each stop', async ($, on) => {
  setup(on)
  const prompt = `/loop ${'check CI '.repeat(133)}`.slice(0, 1200)
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 720, reason: 'wait for CI', prompt } as never)
  const stop = () =>
    $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [],
      session_crons: [{ id: 'w1', schedule: '14 12 9 10 *', recurring: false, prompt: `${prompt.slice(0, 1000)} …[+200 chars]` }],
    })
  await stop()
  await stop()
  const text = await shown($)
  expect(text).toContain('Background · 1')
  expect(text).toContain('wait for CI')
  expect(text).not.toContain('Ended')
})

test('a multi-line wakeup prompt keys its row on one line; the row still reconciles and stops', async ($, on) => {
  const calls: Record<string, unknown>[] = []
  setup(on, [], [], calls)
  const prompt = '/loop check\n  CI'
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 720, reason: 'wait for CI', prompt } as never)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [],
    session_crons: [{ id: 'w1', schedule: '14 12 9 10 *', recurring: false, prompt }],
  })
  const live = await shown($)
  expect(live).toContain('Background · 1')
  expect(live).not.toContain('Ended')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.press({ plugin: 'savvy-progress', key: 'stop-wake:/loop check CI' })
  await ui.unmount()
  expect(calls[0]).toMatchObject({ tool: 'ScheduleWakeup', stop: true })
  const text = await shown($)
  expect(text).not.toContain('Background · ')
  expect(text).toContain('Ended · 1')
})

test('a past-due wakeup reads "due", not "next in 0m"', async ($, on) => {
  const clock = setup(on)
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 720, reason: 'wait for CI', prompt: '/loop check CI' } as never)
  await clock.advance(721_000)
  const text = await shown($)
  expect(text).toContain('due')
  expect(text).not.toContain('next in')
})

test('a cron prompt, a monitor description and a wakeup reason show on one line, started or reconciled', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: 'Monitor', description: 'watch\n  the deploy log', timeout_ms: 300000, command: 'tail -f deploy.log' } as never)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'check\n\tthe deploy' } as never)
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 720, reason: 'wait\n for CI', prompt: '/loop check CI' } as never)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'm1', type: 'monitor', status: 'running', description: 'watch', command: 'tail -f deploy.log' },
      { id: 'm2', type: 'monitor', status: 'running', description: 'tail\n the queue' },
    ],
    session_crons: [
      { id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'check the deploy' },
      { id: 'w1', schedule: '14 12 9 10 *', recurring: false, prompt: '/loop check CI' },
      { id: 'c7', schedule: '*/5 * * * *', recurring: true, prompt: 'poll\n  the queue' },
    ],
  })
  const text = await shown($)
  for (const line of ['watch the deploy log', 'check the deploy', 'wait for CI', 'tail the queue', 'poll the queue']) expect(text).toContain(line)
})

test('the compact toggle is an icon button, not a word', async ($, on) => {
  setup(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Button', text: '⊟' })).length).toBe(1)
  await ui.unmount()
})

test('the stop button is a dim square icon that turns red on hover', async ($, on) => {
  setup(on)
  await bash($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // `hover` is a sibling of `props` in the drawn tree, which findAll does not show.
  expect(JSON.stringify(await ui.drawn())).toMatch(/"label":"■","plain":true,"dimColor":true\},"press":\{[^}]*\},"hover":\{"color":"#b3261e"\}/)
  await ui.unmount()
})

test('a Stop that lists a task twice draws it once, every Client key once', async ($, on) => {
  setup(on)
  const shell = { id: 'b9', type: 'shell', status: 'running', description: 'npm test', command: 'npm test --watch' } as const
  const cron = { id: 'c7', schedule: '*/5 * * * *', recurring: true, prompt: 'poll the queue' }
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shell, shell], session_crons: [cron, cron] })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.drawn()
  const keys = (await ui.findAll({ type: 'Client' })).map(n => n.key)
  const text = (await ui.findAll({})).map(n => `${n.text ?? ''}${(n.props as { alt?: string }).alt ?? ''}`).join('|')
  await ui.unmount()
  expect(new Set(keys).size).toBe(keys.length)
  expect(text).toContain('Background · 2')
  expect(text.split('npm test --watch').length - 1).toBe(1)
})
