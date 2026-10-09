import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]

const PANE = { plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never } as const

const setup = (on: Parameters<TestBody>[1]) => {
  mock.clock(on)
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }))
}
const spawn = ($: $T, description: string) =>
  $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
const end = ($: $T, agentId: string) =>
  $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: agentId, agentId } as never)
// The finished toggle's label: ▸ collapsed, ▾ open.
const toggle = async ($: $T) => {
  const ui = await $.ui.mount(PANE)
  const label = (await ui.findAll({ type: 'Button' })).map(b => b.text).find(t => t?.includes('Ended'))
  await ui.unmount()
  return label
}

test('the last running agent ending collapses the finished group; one still running keeps it open', async ($, on) => {
  setup(on)
  await spawn($, 'fix tests')
  await spawn($, 'pick db')
  await end($, 'w1')
  expect(await toggle($)).toBe('▾ Ended · 1')
  await end($, 'w2')
  expect(await toggle($)).toBe('▸ Ended · 2')
})

test('a background shell still running does not hold the collapse back', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
  await spawn($, 'fix tests')
  await end($, 'w1')
  expect(await toggle($)).toBe('▸ Ended · 1')
})

test('a manual expand stays until the next run ends', async ($, on) => {
  setup(on)
  await spawn($, 'fix tests')
  await end($, 'w1')
  const ui = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'savvy-progress', key: 'done' })
  await ui.unmount()
  expect(await toggle($)).toBe('▾ Ended · 1')
  // A repeat end of an agent already ended is no transition.
  await end($, 'w1')
  expect(await toggle($)).toBe('▾ Ended · 1')
  await spawn($, 'pick db')
  expect(await toggle($)).toBe('▾ Ended · 1')
  await end($, 'w2')
  expect(await toggle($)).toBe('▸ Ended · 2')
})
