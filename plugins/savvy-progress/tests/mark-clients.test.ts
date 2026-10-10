import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { MARK } from './drawing'
import golden from './terminal-golden'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

// The desktop rebuilds a surface's images on every redraw, so a looping image there starts over;
// a Client under one key is kept and draws again only on new props. So every looping drawing on
// the desktop is a Client (mark.tsx) whose props no tick, step, token or click touches. And only
// the three most recent runs loop at once: the rest hold their first frame.

const T0 = Date.UTC(2026, 9, 9, 12, 2, 0)
const PROPS = { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never
const STEP = 'mcp__savvy-progress__step'

const setup = (on: OnT) => {
  const clock = mock.clock(on, { now: T0 })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let agent = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++agent}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }))
  on('turn.step', async function* () {
    return { turnId: 'w1', index: 0, answer: '', toolUses: [], usage: { model: 'claude-opus-5-5', input_tokens: 40_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never
  })
  return clock
}
const spawn = ($: $T, description: string) =>
  $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType: 'savvy-heavy', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
const end = ($: $T, agentId: string) => $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: agentId, agentId } as never)
const tokens = async ($: $T) => {
  for await (const _ of $.turn.step({ turnId: 'w1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'w1' } as never)) void _
}

type Node = { type: string; key?: string; props?: { key?: string; module?: string; source?: string; props?: { source?: string; width?: number; height?: number } } }
const isAnimated = (src = ''): boolean => /class="spin"|class="c-\w+ run"|@keyframes tw\{/.test(src)
const keyOf = (n: Node) => n.props?.key ?? n.key ?? ''

type Mounted = Awaited<ReturnType<$T['ui']['mount']>>
const pane = ($: $T, surface = 'desktop') => $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: PROPS } as never)
const band = ($: $T) => $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

// The looping drawings of a surface: the Svgs that loop (there should be none) and the mark Clients.
const loops = async (mount: () => Promise<Mounted>, before?: (ui: Mounted) => Promise<unknown>) => {
  const ui = await mount()
  await before?.(ui)
  const nodes = (await ui.findAll({})) as unknown as Node[]
  await ui.unmount()
  const svgs = nodes.filter(n => n.type === 'Svg' && isAnimated(n.props?.source))
  const marks = nodes.filter(n => n.type === 'Client' && n.props?.module === MARK)
  return { svgs, marks, keys: marks.filter(n => isAnimated(n.props?.props?.source)).map(keyOf), json: JSON.stringify(marks), statics: nodes.filter(n => n.type === 'Svg').map(n => n.props?.source ?? '') }
}

const expectSteady = (marks: Node[]) => {
  for (const n of marks) {
    expect(keyOf(n)).toBeTruthy()
    expect(Number.isFinite(n.props?.props?.width) && (n.props?.props?.width ?? 0) > 0).toBe(true)
    expect(Number.isFinite(n.props?.props?.height) && (n.props?.props?.height ?? 0) > 0).toBe(true)
  }
}

test('desktop: every looping drawing is a keyed mark Client of fixed size, its props byte-identical across the clock, tokens, a step and a click', async ($, on) => {
  const clock = setup(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Steady', phase: 'delegate', done: 0, total: 4 } as never)
  await spawn($, 'fix tests')
  await spawn($, 'old work')
  await end($, 'w2')
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)

  const full = await loops(() => pane($))
  const bar = await loops(() => band($))
  expect(full.svgs).toEqual([])
  expect(bar.svgs).toEqual([])
  expect(full.keys).toEqual(['crab-w1', 'mark-w1', 'bgmark-b1'])
  expect(bar.keys).toEqual(['band-twinkle', 'band-crab'])
  expectSteady([...full.marks, ...bar.marks])

  await clock.advance(61_370)
  await $.tool.call({ tool: STEP, done: 1, total: 3, note: 'red test', agentId: 'w1' } as never)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', done: 3 } as never)
  await tokens($)
  // The click folds the Ended group open: an ended card's crab stands still, no Client.
  const after = await loops(() => pane($), ui => ui.post({ press: true }, { in: 'done' }))
  expect(after.json).toBe(full.json)
  expect(after.statics.join('')).toContain('1/3 · red test')
  expect((await loops(() => band($))).json).toBe(bar.json)

  // The compact view's crabs are one drawing: one Client, as steady.
  const compact = await loops(() => pane($), ui => ui.post({ press: true }, { in: 'compact' }))
  expect(compact.svgs).toEqual([])
  expect(compact.keys).toEqual(['icons'])
  expectSteady(compact.marks)
  await clock.advance(1_370)
  await tokens($)
  expect((await loops(() => pane($))).json).toBe(compact.json)
})

test('desktop: with five running agents only the three most recent loop, the rest hold still, the same on every redraw', async ($, on) => {
  const clock = setup(on)
  for (const d of ['a', 'b', 'c', 'd', 'e']) {
    await spawn($, d)
    await clock.advance(1_000)
  }
  const first = await loops(() => pane($))
  expect(first.svgs).toEqual([])
  expect(first.keys).toEqual(['crab-w5', 'mark-w5', 'crab-w4', 'mark-w4', 'crab-w3', 'mark-w3'])
  // The two oldest: the crab without its walk, the platter without its turn, both still drawn.
  const held = first.statics.filter(s => s.includes('class="c-heavy"') || s.includes('opacity=".3"'))
  expect(held.length).toBe(4)
  for (const s of held) expect(isAnimated(s)).toBe(false)

  await clock.advance(5_000)
  await tokens($)
  expect((await loops(() => pane($))).json).toBe(first.json)

  // A run's end hands its turn on to the next most recent.
  await end($, 'w5')
  expect((await loops(() => pane($))).keys).toEqual(['crab-w4', 'mark-w4', 'crab-w3', 'mark-w3', 'crab-w2', 'mark-w2'])

  await spawn($, 'f')
  const compact = await loops(() => pane($), ui => ui.post({ press: true }, { in: 'compact' }))
  const icons = compact.marks[0]?.props?.props?.source ?? ''
  expect(icons.match(/class="spin"/g)?.length).toBe(3)
  expect(icons.match(/class="c-\w+ run"/g)?.length).toBe(3)
  expect(icons.match(/opacity="\.3"/g)?.length).toBe(5)
})

test('terminal: the pane and the band draw exactly what they drew before, no Client', async ($, on) => {
  const clock = setup(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Steady', phase: 'delegate', done: 1, total: 4 } as never)
  for (const d of ['a', 'b', 'c', 'd']) {
    await spawn($, d)
    await clock.advance(1_000)
  }
  await end($, 'w1')
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
  await clock.advance(5_000)
  const drawn = async (component: 'Pane' | 'AbovePrompt') => {
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component, requestId: 'savvy-agents', props: PROPS } as never)
    const tree = JSON.parse(JSON.stringify(await ui.drawn(), (k, v) => (k === 'press' ? undefined : v)))
    await ui.unmount()
    return tree
  }
  expect(await drawn('Pane')).toEqual(golden.pane)
  expect(await drawn('AbovePrompt')).toEqual(golden.band)
})

test('mobile and vscode: the band draws its twinkle and crab as images, having no Client', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Steady', phase: 'delegate', done: 0, total: 4 } as never)
  await spawn($, 'a')
  for (const surface of ['mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: PROPS })
    const sources = ((await ui.findAll({ type: 'Svg' })) as unknown as Node[]).map(n => n.props?.source ?? '')
    await ui.unmount()
    expect(sources.some(s => s.includes('@keyframes tw{'))).toBe(true)
    expect(sources.some(s => /class="c-\w+ run"/.test(s))).toBe(true)
  }
})

test('desktop: running agents take the loops before a newer background task', async ($, on) => {
  const clock = setup(on)
  for (const d of ['a', 'b', 'c']) {
    await spawn($, d)
    await clock.advance(1_000)
  }
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
  expect((await loops(() => pane($))).keys).toEqual(['crab-w3', 'mark-w3', 'crab-w2', 'mark-w2', 'crab-w1', 'mark-w1'])
})
