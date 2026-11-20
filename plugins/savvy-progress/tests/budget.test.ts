import { expect, test } from 'claude-code/testing'

import { engineChars } from '../hooks/register'
import { bash, end, finish, PROPS, setup, spawn } from './drawing'
import type { $T, Node } from './drawing'

// The desktop refuses a whole pane past 2000 nodes or 262144 chars and shows "Nothing to show
// yet"; the engine blanks every Client past its 1e5 text budget. Both silently. So the pane
// draws what fits, under both with margin, and says how many it left out.

// The costumes with the most pixels, so the running cards are as big as they get.
const TYPES = ['savvy-medium', 'savvy-heavy', 'savvy-fable', 'savvy-careful', 'savvy-light']

const keyOf = (n: Node) => n.props?.key ?? n.key ?? ''

// The engine's text budget by its own rule, read straight off the flat node list: a Client's props
// as JSON, an Svg's alt, a Text's string. Never an Svg's source.
const drawnChars = (nodes: Node[]) =>
  nodes.reduce((sum, n) => sum + (n.type === 'Client' ? JSON.stringify(n.props).length : n.type === 'Svg' ? (n.props?.alt ?? '').length : n.type === 'Text' ? (n.text ?? '').length : 0), 0)

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

test('desktop pane: 30 running agents and 10 background shells all draw, far inside the engine budget, only three loop', async ($, on) => {
  const clock = setup(on)
  for (let i = 1; i <= 30; i++) {
    await spawn($, `running task number ${i}`, TYPES[i % TYPES.length] ?? '')
    await clock.advance(1_000)
  }
  for (let i = 1; i <= 10; i++) await bash($, `npm run watcher ${i}`)
  const pane = await drawPane($)
  // Held runs are small still images, so 40 runs fit with room to spare: the cut-off line never shows here.
  const chars = drawnChars(pane.nodes)
  expect(chars).toBeLessThan(30_000)
  expect(engineChars(pane.root)).toBeGreaterThanOrEqual(chars)
  expect(engineChars(pane.root)).toBeLessThan(90_000)
  expect(pane.keys.filter(k => /^w\d+$/.test(k) || k.startsWith('bg-')).length).toBe(40)
  expect(pane.texts.some(t => t.includes('more running'))).toBe(false)
  // Only the three most recent agents loop (crab + platter as Clients); every other run is a still image.
  const clients = pane.nodes.filter(n => n.type === 'Client').map(keyOf).filter(k => /^(crab|mark|bgmark)-/.test(k ?? ''))
  expect(clients.sort()).toEqual(['crab-w28', 'crab-w29', 'crab-w30', 'mark-w28', 'mark-w29', 'mark-w30'])
})

test('desktop pane: 80 running agents and 10 background shells stop at the host bound, with a "+N more running" line', async ($, on) => {
  const clock = setup(on)
  for (let i = 1; i <= 80; i++) {
    await spawn($, `running task number ${i}`, TYPES[i % TYPES.length] ?? '')
    await clock.advance(1_000)
  }
  for (let i = 1; i <= 10; i++) await bash($, `npm run watcher ${i}`)
  const pane = await drawPane($)
  // Held runs are small for the engine count, but each still costs the host its tree: the host bound cuts first.
  expect(pane.json.length).toBeLessThan(200_000)
  expect(engineChars(pane.root)).toBeLessThan(90_000)
  const drawn = pane.keys.filter(k => /^w\d+$/.test(k) || k.startsWith('bg-')).length
  expect(drawn).toBeLessThan(90)
  expect(pane.texts).toContain(`+${90 - drawn} more running`)
  // The newest three still loop: looping cards are drawn first, so the cut never takes one.
  const clients = pane.nodes.filter(n => n.type === 'Client').map(keyOf).filter(k => /^(crab|mark|bgmark)-/.test(k ?? ''))
  expect(clients.sort()).toEqual(['crab-w78', 'crab-w79', 'crab-w80', 'mark-w78', 'mark-w79', 'mark-w80'])
})

test('desktop pane: a few running agents all draw, no "more" line', async ($, on) => {
  setup(on)
  for (let i = 1; i <= 3; i++) await spawn($, `small task ${i}`, 'savvy-medium')
  const pane = await drawPane($)
  expect(pane.keys.filter(k => /^w\d+$/.test(k)).length).toBe(3)
  expect(pane.texts.some(t => t.includes('more running'))).toBe(false)
})
