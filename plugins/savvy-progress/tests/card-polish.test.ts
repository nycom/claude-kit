import { expect, test } from 'claude-code/testing'
import { imgOf, PROPS, setup } from './drawing'
import type { $T, OnT } from './drawing'

const STEP = 'mcp__savvy-progress__step'
const USAGE = { model: 'claude-opus-5-5', input_tokens: 40_000, output_tokens: 2_000, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 0 }

// The host's model request beneath the plugins, answering every step with USAGE.
const answers = (on: OnT) =>
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: USAGE } as never
  })
const work = async ($: $T, agentId: string) => {
  for await (const _ of $.turn.step({ turnId: agentId, index: 0, model: USAGE.model, messageCount: 1, agentId } as never)) void _
}
const spawn = ($: $T, description: string, subagentType = 'general-purpose') =>
  $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType, provider: 'claude', parentModel: 'x', background: false, fork: false } as never)

type Node = { type: string; text?: string; props?: { source?: string; module?: string; props?: { source?: string } } }
const draw = async ($: $T, surface = 'desktop') => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: PROPS } as never)
  const nodes = (await ui.findAll({})) as unknown as Node[]
  await ui.unmount()
  return nodes
}
// Every image in the pane, joined: a card's data Svg holds its title.
const sources = (nodes: Node[]) => nodes.map(n => imgOf(n as never)?.source ?? '').join('\n')
const texts = (nodes: Node[]) => nodes.filter(n => n.type === 'Text').map(n => n.text ?? '').join('\n')
// The card's data Svg: the one image that carries this title.
const card = (nodes: Node[], title: string) => nodes.map(n => imgOf(n as never)?.source ?? '').find(s => s.includes(`>${title}<`)) ?? ''

test('card: steps and elapsed on the right, no bare token count', async ($, on) => {
  const clock = setup(on)
  answers(on)
  await spawn($, 'savvy-progress implement')
  await $.tool.call({ tool: STEP, done: 3, total: 5, agentId: 'w1' } as never)
  await work($, 'w1')
  await clock.advance(130_000)
  const src = card(await draw($), 'savvy-progress implement')
  expect(src).toContain('3/5 · 2:10')
  expect(src).not.toMatch(/ · \d+(\.\d+)?[kM]? +≈/)
})

test('card: context and cost on one dim labelled line', async ($, on) => {
  setup(on)
  answers(on)
  await spawn($, 'cache-tax review c1')
  expect(card(await draw($), 'cache-tax review c1')).toContain('ctx — · —')
  await work($, 'w1')
  expect(card(await draw($), 'cache-tax review c1')).toMatch(/ctx \d+% · \$\d+\.\d{2}/)
})

test('card: no bar for an agent that reports no steps', async ($, on) => {
  setup(on)
  answers(on)
  await spawn($, 'e2e tests')
  await work($, 'w1')
  const src = card(await draw($), 'e2e tests')
  // Neither the track nor a grey context fill: the bar is for progress only.
  expect(src).not.toMatch(/<rect[^>]* y="55"/)
})

test("card: a plain agent's progress bar uses the accent", async ($, on) => {
  setup(on)
  await spawn($, 'plain task')
  await $.tool.call({ tool: STEP, done: 1, total: 2, agentId: 'w1' } as never)
  const src = card(await draw($), 'plain task')
  expect(src).toMatch(/<rect x="0" y="55" width="\d+" height="4" rx="2" fill="#8f8cf4"\/>/)
})

test('card: a control character in the note or title is cleaned', async ($, on) => {
  setup(on)
  await spawn($, 'run \u001b[31mred')
  await $.tool.call({ tool: STEP, done: 1, total: 4, note: 'gate \u001b[31m red', agentId: 'w1' } as never)
  const nodes = await draw($)
  expect(sources(nodes)).not.toContain('\u001b')
  expect(texts(nodes)).not.toContain('could not draw')
})

test('flags read in sentence case', async ($, on) => {
  setup(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  await spawn($, 'asks')
  await spawn($, 'fails')
  await $.tool.call({ tool: STEP, done: 1, total: 4, blocked: 'Postgres or SQLite?', agentId: 'w1' } as never)
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: STEP, done: 1, total: 4, failed: true, agentId: 'w2' } as never)
  const all = sources(await draw($))
  expect(all).toContain('>Needs input<')
  expect(all).toContain('>Failed ×3<')
})

test('terminal: a card row shows "3/5 · 2:10" and keeps context and cost', async ($, on) => {
  const clock = setup(on)
  answers(on)
  await spawn($, 'savvy-progress implement')
  await $.tool.call({ tool: STEP, done: 3, total: 5, agentId: 'w1' } as never)
  await work($, 'w1')
  await clock.advance(130_000)
  const all = texts(await draw($, 'terminal'))
  expect(all).toContain('3/5 · 2:10')
  expect(all).toMatch(/ctx \d+% · \$\d+\.\d{2}/)
})
