import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

// 2026-10-09 12:02 UTC: `*/5` next fires at :05 in any whole-quarter-hour time zone.
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

test('Monitor, CronCreate and ScheduleWakeup rows: monitor elapsed, scheduled countdowns', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: 'Monitor', description: 'watch the deploy log', timeout_ms: 300000, command: 'tail -f deploy.log' } as never)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'check the deploy' } as never)
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 720, reason: 'wait for CI', prompt: '/loop check CI' } as never)
  const text = await shown($)
  expect(text).toContain('Background · 3')
  expect(text).toContain('watch the deploy log')
  expect(text).toContain('monitor')
  expect(text).toContain('check the deploy')
  expect(text).toContain('next in 3m')
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
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.findAll({ type: 'Button', text: 'Stop' })).length).toBe(3)
    await ui.unmount()
  }

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
