import { expect, test } from 'claude-code/testing'
import { end, imgOf, PROPS, setup, spawn } from './drawing'
import type { $T } from './drawing'

type Node = { type: string; text?: string; props?: { source?: string; module?: string; props?: { source?: string } } }
const band = async ($: $T, surface = 'desktop') => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: PROPS } as never)
  const nodes = (await ui.findAll({})) as unknown as Node[]
  await ui.unmount()
  return nodes
}
const shown = (nodes: Node[]) => [...nodes.map(n => imgOf(n as never)?.source ?? ''), ...nodes.filter(n => n.type === 'Text').map(n => n.text ?? '')].join('|')

test('no flow: a running subagent brings the band up as "Claude · 2 agents" with no Tasks pill', async ($, on) => {
  setup(on)
  await spawn($, 'look into the parser')
  await spawn($, 'look into the lexer')
  const all = shown(await band($))
  expect(all).toContain('Claude · 2 agents')
  expect(all).not.toContain('Tasks ')
})

test('no flow: after the last agent ends the band reads "Claude · 2 done · 1:05" until the next prompt', async ($, on) => {
  const clock = setup(on)
  await spawn($, 'a')
  await spawn($, 'b')
  await clock.advance(65_000)
  await end($, 'w1', 'answer', false)
  await end($, 'w2', 'answer', false)
  expect(shown(await band($))).toContain('Claude · 2 done · 1:05')
})

test('no flow: a composer prompt clears the band', async ($, on) => {
  setup(on)
  await spawn($, 'a')
  await end($, 'w1') // ends, then the user's next prompt
  expect(shown(await band($))).not.toContain('Claude ·')
})

test('terminal: the no-flow band prints the same title as text', async ($, on) => {
  setup(on)
  await spawn($, 'a')
  await spawn($, 'b')
  expect(shown(await band($, 'terminal'))).toContain('Claude · 2 agents')
})

test('no flow: the band does not redraw on the clock tick', async ($, on) => {
  const clock = setup(on)
  await spawn($, 'a')
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: PROPS } as never)
  const before = JSON.stringify(await ui.drawn())
  await clock.advance(3_000)
  expect(JSON.stringify(await ui.drawn())).toBe(before)
  await ui.unmount()
})
