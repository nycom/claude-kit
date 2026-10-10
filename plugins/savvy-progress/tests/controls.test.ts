import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

const PANE = { plugin: 'savvy-progress', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never } as const

const setup = (on: OnT, calls: Record<string, unknown>[] = []) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 2, 0) })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w1' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }))
  on('tool.call', { tool: 'TaskStop' }, (_$, e) => (calls.push(e as never), { result: { message: 'stopped', task_id: 'b1', task_type: 'local_bash' } }))
}

// One agent ended (so the Ended toggle shows) and one background shell running (so a Stop shows).
const fill = async ($: $T) => {
  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'fix tests', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 'w1', agentId: 'w1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
}

type Node = { type: string; key?: string; props?: { key?: string; module?: string; props?: { label?: string } } }
const clientsOf = async (ui: { findAll: (q: object) => Promise<unknown[]> }) =>
  ((await ui.findAll({ type: 'Client' })) as Node[]).filter(n => n.props?.module === 'hooks/controls.tsx').map(n => [n.props?.key ?? n.key, n.props?.module, n.props?.props?.label])

// A Pane Button's press is resolved on the desktop by a handle every redraw replaces, so the
// desktop presses it never land; a Client is addressed by its key.
test('desktop pane: the Ended toggle, the compact toggle and each Stop are Client regions, no Buttons', async ($, on) => {
  setup(on)
  await fill($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await clientsOf(ui)).toEqual([
    ['compact', 'hooks/controls.tsx', '⊟'],
    ['stop-b1', 'hooks/controls.tsx', '■'],
    ['done', 'hooks/controls.tsx', '▸ Ended · 1'],
  ])
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})

test('terminal pane keeps its Buttons', async ($, on) => {
  setup(on)
  await fill($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Client' })).length).toBe(0)
  for (const key of ['compact', 'done', 'stop-b1']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  await ui.unmount()
})

test('a click on a desktop control posts by key: collapse flips, compact flips, Stop ends the task', async ($, on) => {
  const calls: Record<string, unknown>[] = []
  setup(on, calls)
  await fill($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const label = async (key: string) => ((await ui.findAll({ type: 'Client' })) as Node[]).find(n => (n.props?.key ?? n.key) === key)?.props?.props?.label

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'done' })
  expect(await label('done')).toBe('▾ Ended · 1')
  await ui.post({ press: true }, { in: 'done' })
  expect(await label('done')).toBe('▸ Ended · 1')

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'stop-b1' })
  expect(calls).toMatchObject([{ tool: 'TaskStop', task_id: 'b1' }])
  expect(await label('stop-b1')).toBeUndefined()
  expect(await label('done')).toBe('▸ Ended · 2')

  await ui.post({ press: true }, { in: 'compact' })
  expect(await label('compact')).toBe('⊞')
  await ui.unmount()
})

test('the desktop Stop is dim and turns the palette red on hover; the toggles are plain', async ($, on) => {
  setup(on)
  await fill($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = async (key: string) => JSON.stringify(await ui.drawn({ in: key }))
  expect(await text('stop-b1')).toContain('"dimColor":true')
  expect(await text('stop-b1')).not.toContain('#b3261e')
  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'stop-b1' })
  expect(await text('stop-b1')).toContain('"color":"#b3261e"')
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'stop-b1' })
  expect(await text('stop-b1')).not.toContain('#b3261e')
  expect(await text('done')).not.toContain('dimColor')
  await ui.unmount()
})
