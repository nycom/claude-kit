import { expect, test } from 'claude-code/testing'

import { PROPS, setup, spawn } from './drawing'
import type { $T } from './drawing'

// The desktop band's bar is laid out by the app, not sized in px from a column guess: a track Box
// that grows into the row, its segments sharing it by flexGrow.
type N = { type: string; props?: Record<string, unknown> & { key?: string; flexGrow?: number; backgroundColor?: string; alt?: string; width?: number; position?: string }; children?: N[] }
const PROGRESS = 'mcp__savvy-progress__progress'
const tree = async ($: $T) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: PROPS } as never)
  const root = (await ui.drawn()) as unknown as N
  await ui.unmount()
  return root
}
const all = (n: N): N[] => [n, ...(n.children ?? []).flatMap(c => (typeof c === 'object' ? all(c) : []))]
const trackOf = (root: N) => all(root).find(n => n.type === 'Box' && n.props?.flexGrow === 1 && (n.children ?? []).some(c => c.props?.backgroundColor))
const segs = (track: N) => (track.children ?? []).filter(c => c.type === 'Box' && c.props?.backgroundColor)

test('desktop band: the bar is a growing track; done takes its share of it by flexGrow', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: PROGRESS, title: 'Flex', phase: 'review', done: 2, total: 5 } as never)
  await spawn($, 'a')
  const root = await tree($)
  const track = trackOf(root)
  if (!track) throw new Error('no growing track')
  const grows = segs(track).map(s => s.props?.flexGrow ?? 0)
  expect(grows[0]).toBe(2)
  expect(grows.reduce((a, b) => a + b, 0)).toBe(5)
  // Nothing in the band is placed or sized by cells or px guesses.
  expect(all(root).some(n => n.props?.position === 'absolute')).toBe(false)
  expect(all(root).every(n => n.type !== 'Svg' || Number(n.props?.width) < 400)).toBe(true)
})

test('desktop band: the pill rides the head of the fill, the glow just past it', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: PROGRESS, title: 'Flex', phase: 'review', done: 1, total: 3 } as never)
  await spawn($, 'a')
  const track = trackOf(await tree($))
  const kids = (track?.children ?? []).map(c => (c.type === 'Client' ? `Client:${c.props?.key}` : c.props?.backgroundColor ? 'seg' : `${c.type}:${c.props?.alt}`))
  expect(kids.slice(0, 3)).toEqual(['seg', 'Svg:Review 1/3', 'Client:band-glow'])
})

test('desktop band: a finished flow is all fill, with no glow', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: PROGRESS, title: 'Flex', phase: 'close', done: 3, total: 3, finished: true } as never)
  await spawn($, 'a')
  const track = trackOf(await tree($))
  if (!track) throw new Error('no growing track')
  const grows = segs(track).map(s => s.props?.flexGrow ?? 0)
  expect(grows[0]).toBeGreaterThan(0)
  expect(grows.slice(1).every(g => g === 0)).toBe(true)
  expect(JSON.stringify(track)).not.toContain('band-glow')
})

test('desktop band: a full bar has no track colour peeking past the pill before its end', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: PROGRESS, title: 'Flex', phase: 'review', done: 3, total: 3 } as never)
  await spawn($, 'a')
  const track = trackOf(await tree($))
  const pill = (track?.children ?? []).find(c => c.type === 'Svg' && c.props?.alt === 'Review 3/3')
  if (!pill) throw new Error('no pill')
  expect(String(pill.props?.source)).not.toContain('fill-opacity="0.2"')
  expect(String(pill.props?.source)).not.toMatch(/ A8 8 0 0 1 /)
})
