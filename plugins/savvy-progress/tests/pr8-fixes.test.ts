import { expect, test } from 'claude-code/testing'

import { bash, end, PROPS, setup, spawn } from './drawing'
import type { $T, Node } from './drawing'

const keyOf = (n: Node) => n.props?.key ?? n.key ?? ''
type Laid = Node
const mount = async ($: $T, component: string) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component, requestId: 'savvy-agents', props: PROPS } as never)
  const nodes = (await ui.findAll({})) as unknown as Laid[]
  await ui.unmount()
  return nodes
}
const PROGRESS = 'mcp__savvy-progress__progress'

test('desktop band: the crab, the count and ✕ sit together after the growing bar, at the row right edge', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: PROGRESS, title: 'Polish recheck', phase: 'review', done: 2, total: 3 } as never)
  await spawn($, 'recheck')
  const nodes = await mount($, 'AbovePrompt')
  const row = nodes.find(n => n.type === 'Box' && (n.children ?? []).some(c => typeof c === 'object' && (c.props as { flexGrow?: number } | undefined)?.flexGrow === 1))
  if (!row) throw new Error('no row with a growing bar')
  const kids = row.children as Laid[]
  const right = JSON.stringify(kids.at(-1))
  for (const k of ['band-crab', 'savvy-agents', 'savvy-dismiss']) expect(right).toContain(k)
  expect((kids.at(-2)?.props as { flexGrow?: number } | undefined)?.flexGrow).toBe(1)
  // Nothing between them: the crab sits right against the count.
  expect((kids.at(-1)?.props as { gap?: number } | undefined)?.gap).toBeUndefined()
})

test('desktop pane: a long-running agent and its Background row still draw beside 80 held finished agents', async ($, on) => {
  const clock = setup(on)
  await spawn($, 'the long runner')
  for (let i = 2; i <= 81; i++) {
    await spawn($, `quick task number ${i}`, 'savvy-heavy')
    await clock.advance(1_000)
    await end($, `w${i}`, 'answer', false)
  }
  await bash($, 'npm run watcher')
  const keys = (await mount($, 'Pane')).map(keyOf)
  expect(keys).toContain('w1')
  expect(keys).toContain('bg-b1')
  expect(keys).toContain('stop-b1')
  // The newest held cards stay in Running; the rest go to Ended.
  expect(keys).toContain('w81')
  expect(keys).not.toContain('w2')
})

test('desktop band: no glow once the bar is full', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: PROGRESS, title: 'All steps done', phase: 'review', done: 3, total: 3 } as never)
  await spawn($, 'still running')
  expect((await mount($, 'AbovePrompt')).map(keyOf)).not.toContain('band-glow')
})
