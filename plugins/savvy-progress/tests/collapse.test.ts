import { expect, test } from 'claude-code/testing'

import { bash, end, PROPS, setup, spawn } from './drawing'
import type { $T } from './drawing'

const PANE = { plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: PROPS } as const

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
  await bash($, 'npm run dev')
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
