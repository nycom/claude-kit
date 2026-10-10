import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

// A desktop Svg is an image: any change in its source is a new image whose animations start
// over. So every looping drawing has a source that no tick, step, token count or clock reading
// touches; what changes is drawn beside or over it, in drawings of its own.

const T0 = Date.UTC(2026, 9, 9, 12, 2, 0)
const PROPS = { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never
const STEP = 'mcp__savvy-progress__step'

const setup = (on: OnT) => {
  const clock = mock.clock(on, { now: T0 })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w1' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }))
  on('turn.step', async function* () {
    return { turnId: 'w1', index: 0, answer: '', toolUses: [], usage: { model: 'claude-opus-5-5', input_tokens: 40_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never
  })
  return clock
}

// A worker's model request: its tokens and cost move.
const tokens = async ($: $T) => {
  const stream = $.turn.step({ turnId: 'w1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'w1' } as never)
  for await (const _ of stream) void _
}

type Node = { type: string; text?: string; props?: { source?: string; alt?: string; width?: number; height?: number; position?: string }; children?: (Node | string)[] }
const isAnimated = (src: string): boolean => /class="spin"|class="c-\w+ run"|@keyframes tw\{/.test(src)

// Every Svg in drawing order, and the tree's shape with each Svg marked animated or data.
const draw = async ($: $T, mount: () => ReturnType<$T['ui']['mount']>) => {
  const ui = await mount()
  const [root] = (await ui.findAll({})) as unknown as Node[]
  const svgs = ((await ui.findAll({ type: 'Svg' })) as unknown as Node[]).map(n => n.props?.source ?? '')
  await ui.unmount()
  const shape = (n: Node | string): unknown =>
    typeof n === 'string'
      ? 's'
      : n.type === 'Svg'
        ? `Svg:${isAnimated(n.props?.source ?? '') ? 'A' : 'D'}:${n.props?.width}x${n.props?.height}`
        : [n.type, n.props?.position ?? '', (n.children ?? []).map(shape)]
  return { animated: svgs.filter(isAnimated), data: svgs.filter(s => !isAnimated(s)), shape: JSON.stringify(shape(root as Node)) }
}
const pane = ($: $T) => () => $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: PROPS })
const band = ($: $T) => () => $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

// Every animation delay a drawing carries, in order.
const delays = (srcs: string[]): string[] => srcs.flatMap(s => [...s.matchAll(/(?:animation-delay:|infinite )(-?[\d.]+s)/g)].map(m => m[1] ?? ''))

const REDUCED = ['@media (prefers-reduced-motion: reduce){.spin{animation:none!important}}', '@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}']

test('desktop pane: a running card and a background row keep byte-identical animated drawings across a tick, a step, tokens and the clock', async ($, on) => {
  const clock = setup(on)
  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'fix tests', subagentType: 'savvy-careful', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
  const before = await draw($, pane($))
  // The crab and the platter of the card, the platter of the background row.
  expect(before.animated.length).toBe(3)

  await clock.advance(61_370)
  await $.tool.call({ tool: STEP, done: 1, total: 3, note: 'red test', agentId: 'w1' } as never)
  await tokens($)
  const after = await draw($, pane($))

  expect(after.animated).toEqual(before.animated)
  expect(after.shape).toBe(before.shape)
  // The data did move: the step, the tokens, the card's time and the row's minutes.
  const data = after.data.join('')
  expect(before.data.join('')).not.toContain('1/3 · red test')
  for (const text of ['1/3 · red test', '42k', '1:01', 'shell · 1m']) expect(data).toContain(text)
  expect(delays([...after.animated, ...after.data])).toEqual(delays([...before.animated, ...before.data]))
  for (const rule of REDUCED) expect(after.animated.join('')).toContain(rule)
})

test('desktop compact pane: the crabs and platters keep their drawing while the totals tick', async ($, on) => {
  const clock = setup(on)
  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'fix tests', subagentType: 'savvy-heavy', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  const ui = await pane($)()
  await $.ui.press({ plugin: 'savvy-progress', key: 'compact' })
  await ui.unmount()
  const before = await draw($, pane($))
  expect(before.animated.length).toBeGreaterThan(0)
  expect(before.animated.join('')).toContain('class="spin"')

  await clock.advance(1_370)
  await tokens($)
  const after = await draw($, pane($))
  expect(after.animated).toEqual(before.animated)
  expect(after.shape).toBe(before.shape)
  expect(after.data.join('')).not.toBe(before.data.join(''))
  expect(after.data.join('')).toContain('42k')
})

test('desktop band: the twinkle and the crab keep byte-identical drawings while progress, steps and the clock move', async ($, on) => {
  const clock = setup(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Steady band', phase: 'delegate', done: 0, total: 4 } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'walk steady', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  const before = await draw($, band($))
  // The bar's twinkle and the walking crab.
  expect(before.animated.length).toBe(2)

  await clock.advance(1_370)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', done: 3 } as never)
  await $.tool.call({ tool: STEP, done: 1, total: 3, agentId: 'w1' } as never)
  await tokens($)
  const after = await draw($, band($))

  expect(after.animated).toEqual(before.animated)
  expect(after.shape).toBe(before.shape)
  expect(after.data.join('')).toContain('75%')
  expect(before.data.join('')).not.toContain('75%')
  expect(delays([...after.animated, ...after.data])).toEqual(delays([...before.animated, ...before.data]))
  const anim = after.animated.join('')
  expect(anim).toContain('@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}')
  expect(anim).toContain(REDUCED[1])
})
