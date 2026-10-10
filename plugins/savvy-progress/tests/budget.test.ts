import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

// The desktop refuses a whole pane past 2000 nodes or 262144 chars and shows "Nothing to show
// yet"; the engine blanks every Client past its 1e5 text budget. Both silently. So the pane
// draws what fits, under both with margin, and says how many it left out.

const T0 = Date.UTC(2026, 9, 9, 12, 2, 0)
const PROPS = { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never

const setup = (on: OnT) => {
  const clock = mock.clock(on, { now: T0 })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let agent = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++agent}` }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  let task = 0
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `b${++task}` } }))
  return clock
}
// The costumes with the most pixels, so the running cards are as big as they get.
const spawn = ($: $T, description: string, subagentType: string) =>
  $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType, provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
const end = ($: $T, agentId: string) => $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: agentId, agentId } as never)
const bash = ($: $T, command: string) => $.tool.call({ tool: 'Bash', command, run_in_background: true } as never)
const finish = ($: $T, id: string) =>
  $.prompt.submit({ text: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`, origin: { kind: 'task-notification' }, wait: false } as never)
const TYPES = ['savvy-medium', 'savvy-heavy', 'savvy-fable', 'savvy-careful', 'savvy-light']

type Node = { type: string; key?: string; text?: string; props?: { key?: string; alt?: string; source?: string; module?: string; props?: unknown }; children?: (Node | string)[] }
const keyOf = (n: Node) => n.props?.key ?? n.key ?? ''

// What the engine's budget counts: Client props, Svg alts and strings, never an Svg's source.
const engineChars = (n: Node | string): number =>
  typeof n === 'string' ? n.length : n.type === 'Client' ? JSON.stringify(n.props).length : n.type === 'Svg' ? (n.props?.alt ?? '').length : (n.children ?? []).reduce((s, c) => s + engineChars(c), 0)

const drawPane = async ($: $T, press?: string) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: PROPS })
  if (press) await ui.post({ press: true }, { in: press })
  const json = JSON.stringify(await ui.drawn())
  const nodes = (await ui.findAll({})) as unknown as Node[]
  await ui.unmount()
  const texts = nodes.filter(n => n.type === 'Text').map(n => n.text ?? '')
  return { json, nodes, texts, root: nodes[0] as Node, keys: nodes.map(keyOf) }
}

test('desktop pane: 60 ended agents and 30 ended background rows draw the newest 20 and a "+70 more ended" line, well inside the host bounds', async ($, on) => {
  const clock = setup(on)
  for (let i = 1; i <= 30; i++) {
    await bash($, `build step ${i}`)
    await clock.advance(1_000)
    await finish($, `b${i}`)
  }
  for (let i = 1; i <= 60; i++) {
    await spawn($, `ended task number ${i}`, TYPES[i % TYPES.length] ?? '')
    await clock.advance(1_000)
    await end($, `w${i}`)
  }
  // The last end folded the group: open it.
  const pane = await drawPane($, 'done')
  expect(pane.json.length).toBeLessThan(200_000)
  expect(pane.nodes.length).toBeLessThan(2000)
  // The agents ended last are the newest: w60 down to w41, no background row.
  const cards = pane.keys.filter(k => /^w\d+$/.test(k))
  expect(cards).toEqual(Array.from({ length: 20 }, (_, i) => `w${60 - i}`))
  expect(pane.keys.filter(k => k.startsWith('bg-'))).toEqual([])
  expect(pane.texts).toContain('+70 more ended')
  // An ended crab stands still: no motion rules in its drawing.
  const crab = pane.nodes.find(n => keyOf(n) === 'w60')?.children?.[0] as Node | undefined
  expect(crab?.type).toBe('Svg')
  expect(crab?.props?.source).not.toContain('@keyframes')
  expect(crab?.props?.source).not.toContain('.run')
})

test('desktop pane: the newest ended items mix agents and background rows by when they ended', async ($, on) => {
  const clock = setup(on)
  for (let i = 1; i <= 15; i++) {
    await spawn($, `old task ${i}`, 'general-purpose')
    await clock.advance(1_000)
    await end($, `w${i}`)
  }
  for (let i = 1; i <= 10; i++) {
    await bash($, `late build ${i}`)
    await clock.advance(1_000)
    await finish($, `b${i}`)
  }
  const pane = await drawPane($, 'done')
  // The 10 rows and the 10 agents that ended last, agents first as before.
  expect(pane.keys.filter(k => /^w\d+$/.test(k))).toEqual(Array.from({ length: 10 }, (_, i) => `w${15 - i}`))
  expect(pane.keys.filter(k => k.startsWith('bg-'))).toEqual(Array.from({ length: 10 }, (_, i) => `bg-b${10 - i}`))
  expect(pane.texts).toContain('+5 more ended')
})

test('desktop pane: 30 running agents and 10 background shells stay inside the engine budget, the rest a "+N more running" line', async ($, on) => {
  const clock = setup(on)
  for (let i = 1; i <= 30; i++) {
    await spawn($, `running task number ${i}`, TYPES[i % TYPES.length] ?? '')
    await clock.advance(1_000)
  }
  for (let i = 1; i <= 10; i++) await bash($, `npm run watcher ${i}`)
  const pane = await drawPane($)
  expect(engineChars(pane.root)).toBeLessThan(90_000)
  expect(pane.json.length).toBeLessThan(200_000)
  const drawn = pane.keys.filter(k => /^w\d+$/.test(k) || k.startsWith('bg-')).length
  const more = 40 - drawn
  expect(more).toBeGreaterThan(0)
  expect(pane.texts).toContain(`+${more} more running`)
  // Every card that is drawn loops: its crab and its platter are Clients.
  const cards = pane.keys.filter(k => /^w\d+$/.test(k))
  for (const k of cards) for (const part of ['crab', 'mark']) expect(pane.nodes.find(n => keyOf(n) === `${part}-${k}`)?.type).toBe('Client')
})

test('desktop pane: a few running agents all draw, no "more" line', async ($, on) => {
  setup(on)
  for (let i = 1; i <= 3; i++) await spawn($, `small task ${i}`, 'savvy-medium')
  const pane = await drawPane($)
  expect(pane.keys.filter(k => /^w\d+$/.test(k)).length).toBe(3)
  expect(pane.texts.some(t => t.includes('more running'))).toBe(false)
})
