import { expect, test } from 'claude-code/testing'
import { end, imgOf, MARK, PROPS, setup, spawn } from './drawing'
import type { $T } from './drawing'

type Node = { type: string; key?: string; text?: string; props?: { key?: string; source?: string; module?: string; props?: { source?: string }; label?: string } }
const draw = async ($: $T, press?: string) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: PROPS } as never)
  if (press) await ui.post({ press: true }, { in: press })
  const nodes = (await ui.findAll({})) as unknown as Node[]
  await ui.unmount()
  return nodes
}
const texts = (nodes: Node[]) => nodes.filter(n => n.type === 'Text').map(n => n.text ?? '').join('|')
const card = (nodes: Node[], title: string) => nodes.map(n => imgOf(n as never)?.source ?? '').find(s => s.includes(`>${title}<`)) ?? ''
const submit = ($: $T, kind: string) => $.prompt.submit({ text: kind === 'task-notification' ? '<task-notification>\n<task-id>x</task-id>\n<status>completed</status>\n</task-notification>' : 'next', wait: false, origin: { kind } } as never)
const DONE_TICK = 'stroke="#3B9C5F"'

test('a finished card stays in Running with a still done pose and "took m:ss"', async ($, on) => {
  const clock = setup(on)
  await spawn($, 'write docs')
  await clock.advance(65_000)
  await end($, 'w1', 'answer', false)
  const nodes = await draw($)
  expect(texts(nodes)).toContain('Running · 1')
  expect(card(nodes, 'write docs')).toContain('took 1:05')
  expect(nodes.map(n => imgOf(n as never)?.source ?? '').join('')).toContain(DONE_TICK)
})

test('a failed run is held with the failed pose and "failed after m:ss"', async ($, on) => {
  const clock = setup(on)
  await spawn($, 'fix tests')
  await clock.advance(42_000)
  await end($, 'w1', 'error', false)
  const nodes = await draw($)
  expect(texts(nodes)).toContain('Running · 1')
  expect(card(nodes, 'fix tests')).toContain('failed after 0:42')
})

test('a task notification or a scheduled trigger does not release the hold', async ($, on) => {
  setup(on)
  await spawn($, 'write docs')
  await end($, 'w1', 'answer', false)
  await submit($, 'task-notification')
  await submit($, 'scheduled-trigger')
  expect(texts(await draw($))).toContain('Running · 1')
})

for (const kind of ['composer', 'bridge'] as const)
  test(`Nati's next prompt (${kind}) releases the hold and then folds Ended`, async ($, on) => {
    setup(on)
    await spawn($, 'write docs')
    await end($, 'w1', 'answer', false)
    await submit($, kind)
    const nodes = await draw($)
    expect(texts(nodes)).not.toContain('Running · 1')
    // The Ended group is folded: its toggle reads ▸ and the card is not drawn.
    const done = nodes.find(n => n.props?.module === 'hooks/controls.tsx' && (n.key ?? n.props?.key) === 'done') as { props?: { props?: { label?: string } } } | undefined
    expect(done?.props?.props?.label).toMatch(/^▸/)
    expect(card(nodes, 'write docs')).toBe('')
  })

test('the hold shows even when Ended was collapsed by hand', async ($, on) => {
  setup(on)
  await spawn($, 'first')
  await end($, 'w1', 'answer', false)
  await submit($, 'composer') // folds Ended
  await spawn($, 'second')
  await end($, 'w2', 'answer', false)
  const nodes = await draw($)
  expect(texts(nodes)).toContain('Running · 1')
  expect(card(nodes, 'second')).toContain('took ')
})

test('held cards add no loops', async ($, on) => {
  setup(on)
  for (const d of ['a', 'b', 'c', 'd', 'e']) await spawn($, d, 'savvy-heavy')
  await end($, 'w1', 'answer', false)
  await end($, 'w2', 'answer', false)
  const nodes = await draw($)
  const loops = nodes.filter(n => n.type === 'Client' && n.props?.module === MARK && /^(crab|mark)-/.test(n.key ?? n.props?.key ?? ''))
  expect(loops.length).toBe(6)
  expect(texts(nodes)).toContain('Running · 5')
})
