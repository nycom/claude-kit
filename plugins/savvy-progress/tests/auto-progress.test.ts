import { expect, test } from 'claude-code/testing'

import { end, setup, spawn } from './drawing'
import type { $T } from './drawing'

const plan = ($: $T) =>
  $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', total: 2, tasks: [{ title: 'a' }, { title: 'b' }] } as never)
// The band's own words: "<title>: <label>, <percent>".
const band = async ($: $T) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  const alt = (await ui.findAll({ type: 'Svg' })).map(n => (n as unknown as { props?: { alt?: string } }).props?.alt)[0]
  await ui.unmount()
  return alt
}

test('a delegate run moves the bar from its agent labels, through to finished', async ($, on) => {
  setup(on)
  await plan($)
  expect(await band($)).toBe('Ship it: Plan, 0%')
  await spawn($, 'a implement') // w1
  expect(await band($)).toBe('Ship it: Tasks 0/2, 0%')
  await spawn($, 'a review c1') // w2
  expect(await band($)).toBe('Ship it: Review 0/2, 0%')
  // A fix round's implement never takes the phase back.
  await spawn($, 'a implement') // w3
  expect(await band($)).toBe('Ship it: Review 0/2, 0%')
  await end($, 'w1')
  await end($, 'w2')
  await end($, 'w3')
  await spawn($, 'a merge') // w4
  await end($, 'w4')
  expect(await band($)).toBe('Ship it: Tasks 1/2, 50%')
  // Close stays close: a late review label does not reopen review.
  await spawn($, 'b review c1') // w5
  await end($, 'w5')
  expect(await band($)).toBe('Ship it: Tasks 1/2, 50%')
  await spawn($, 'b merge') // w6
  await end($, 'w6')
  expect(await band($)).toBe('Ship it: Tasks 2/2, 100%')
  await spawn($, 'x docs') // w7
  expect(await band($)).toBe('Ship it: Tasks 2/2, 100%')
  await end($, 'w7')
  expect(await band($)).toBe('Ship it: Done, 100%')
})

test('a failed merge does not count a task done', async ($, on) => {
  setup(on)
  await plan($)
  await spawn($, 'a merge')
  await end($, 'w1', 'error')
  expect(await band($)).toBe('Ship it: Tasks 0/2, 0%')
  // The same task merged twice counts once.
  await spawn($, 'a merge')
  await end($, 'w2')
  await spawn($, 'a merge')
  await end($, 'w3')
  expect(await band($)).toBe('Ship it: Tasks 1/2, 50%')
})

test('docs ending before every task merged leaves finishing to the coordinator', async ($, on) => {
  setup(on)
  await plan($)
  await spawn($, 'a merge')
  await end($, 'w1')
  await spawn($, 'repo docs')
  await end($, 'w2')
  expect(await band($)).toBe('Ship it: Tasks 1/2, 50%')
})

test('a manual flow whose agents match no task is left to the coordinator', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Manual', total: 2, done: 1, phase: 'design', tasks: [{ title: 'pick db' }, { title: 'write api' }] } as never)
  await spawn($, 'repo review')
  await spawn($, 'other merge')
  await end($, 'w2')
  await spawn($, 'repo docs')
  await end($, 'w1')
  await end($, 'w3')
  expect(await band($)).toBe('Manual: Design, 50%')
})

test('a coordinator call still overwrites what the labels set', async ($, on) => {
  setup(on)
  await plan($)
  await spawn($, 'a review c1')
  expect(await band($)).toBe('Ship it: Review 0/2, 0%')
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', phase: 'delegate', done: 1 } as never)
  expect(await band($)).toBe('Ship it: Tasks 1/2, 50%')
})

test("the delegate skill's own close still lands on a flow the labels finished", async ($, on) => {
  setup(on)
  await plan($)
  for (const task of ['a', 'b']) {
    await spawn($, `${task} merge`)
    await end($, `w${task === 'a' ? 1 : 2}`)
  }
  await spawn($, 'x docs') // w3
  await end($, 'w3')
  expect(await band($)).toBe('Ship it: Done, 100%')
  // The skill then reports the close and finishes, with no title: the same flow, not a blank one.
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', done: 2, phase: 'close' } as never)
  expect(await band($)).toBe('Ship it: Done, 100%')
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', finished: true } as never)
  expect(await band($)).toBe('Ship it: Done, 100%')
})

test('a docs agent that failed does not finish the flow', async ($, on) => {
  setup(on)
  await plan($)
  for (const task of ['a', 'b']) {
    await spawn($, `${task} merge`)
    await end($, `w${task === 'a' ? 1 : 2}`)
  }
  await spawn($, 'x docs') // w3
  await end($, 'w3', 'error')
  expect(await band($)).toBe('Ship it: Tasks 2/2, 100%')
})
