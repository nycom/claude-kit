import { expect, test } from 'claude-code/testing'
import { textWidth } from '../hooks/register'
import { end, imgOf, PROPS, setup, spawn } from './drawing'
import type { $T } from './drawing'

const STEP = 'mcp__savvy-progress__step'
type Node = { type: string; key?: string; text?: string; props?: Record<string, unknown> & { source?: string; module?: string; label?: string; props?: { source?: string }; left?: number } }
const mount = async ($: $T, component: 'Pane' | 'AbovePrompt', bodyColumns = 120) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component, requestId: component === 'Pane' ? 'savvy-agents' : undefined, props: { bodyColumns, hasSurvey: false, maxRows: 5 } } as never)
  const nodes = (await ui.findAll({})) as unknown as Node[]
  const json = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return { nodes, json }
}
const srcs = (nodes: Node[]) => nodes.map(n => imgOf(n as never)?.source ?? '')
const cardOf = (nodes: Node[], title: string) => srcs(nodes).find(s => s.includes(`>${title}<`)) ?? ''
const barFillOf = (src: string) => /<rect x="0" y="55" width="\d+" height="4" rx="2" fill="(#[0-9a-fA-F]{6})"\/>/.exec(src)?.[1]

test('bars take the role colour: implement cyan, review magenta, test lime, design rose, Explore slate', async ($, on) => {
  setup(on)
  const cases: [type: string, task: string, colour: string][] = [
    ['general-purpose', 'implement the cache', '#1FA8B8'],
    ['general-purpose', 'review PR 42', '#C4479B'],
    ['general-purpose', 'write e2e tests', '#8AA62A'],
    ['general-purpose', 'design the onboarding', '#E0567A'],
    ['Explore', 'map the auth flow', '#7A8FA8'],
  ]
  for (const [type, task] of cases) await spawn($, task, type)
  for (let i = 1; i <= cases.length; i++) await $.tool.call({ tool: STEP, done: 1, total: 2, agentId: `w${i}` } as never)
  const { nodes } = await mount($, 'Pane')
  for (const [, task, colour] of cases) expect(barFillOf(cardOf(nodes, task))).toBe(colour)
})

test('a savvy tier keeps its tier colour even when the task names a role', async ($, on) => {
  setup(on)
  await spawn($, 'review the plan', 'savvy-heavy')
  await $.tool.call({ tool: STEP, done: 1, total: 2, agentId: 'w1' } as never)
  expect(barFillOf(cardOf((await mount($, 'Pane')).nodes, 'review the plan'))).toBe('#D85A30')
})

test('summary: during the finish hold it says "2 done", not "2 running"', async ($, on) => {
  setup(on)
  await spawn($, 'a')
  await spawn($, 'b')
  await end($, 'w1', 'answer', false)
  await end($, 'w2', 'error', false)
  const all = srcs((await mount($, 'Pane')).nodes).join('')
  expect(all).toContain('>2 done · — · —<')
  expect(all).not.toContain('2 running')
})

// Every text's drawn extent on a row: start-anchored grows right from x, end-anchored grows left.
const spans = (src: string) =>
  [...src.matchAll(/<text([^>]*) x="([\d.]+)" y="([\d.]+)"([^>]*)>([\s\S]*?)<\/text>/g)].map(m => {
    const attrs = `${m[1]}${m[4]}`
    const size = Number(/font-size="([\d.]+)"/.exec(attrs)?.[1] ?? 11)
    const text = (m[5] ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    const w = textWidth(text, size)
    const x = Number(m[2])
    return { y: Number(m[3]), from: /text-anchor="end"/.test(attrs) ? x - w : x, to: /text-anchor="end"/.test(attrs) ? x : x + w, text }
  })

test('at 40 columns no two texts on a card row overlap, and none runs past the card', async ($, on) => {
  setup(on)
  await spawn($, 'review the long plan', 'acme:code-reviewer')
  await $.tool.call({ tool: STEP, done: 1, total: 4, note: 'reading', agentId: 'w1' } as never)
  const src = srcs((await mount($, 'Pane', 40)).nodes).find(s => s.includes('review the long plan')) ?? ''
  const W = Number(/<svg[^>]* width="([\d.]+)"/.exec(src)?.[1])
  const rows = spans(src)
  for (const s of rows) {
    expect(s.from).toBeGreaterThanOrEqual(-0.5)
    expect(s.to).toBeLessThanOrEqual(W + 0.5)
  }
  for (const a of rows) for (const b of rows) if (a !== b && a.y === b.y && a.from < b.from) expect(a.to).toBeLessThanOrEqual(b.from)
})

test('band: the glow sits at the pill\'s right edge, never hidden under it', async ($, on) => {
  setup(on)
  for (const done of [0, 1, 2, 4]) {
    await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Flow', phase: 'delegate', total: 5, done } as never)
    if (done === 0) await spawn($, 'a')
    const { nodes, json } = await mount($, 'AbovePrompt')
    const top = srcs(nodes).find(s => s.includes('>Tasks ')) ?? ''
    const bx = Number(/<g transform="translate\(([\d.]+),/.exec(top)?.[1])
    const [, px, pw] = /<rect x="([\d.]+)" width="([\d.]+)" height="16"/.exec(top) ?? []
    const pillRight = bx + Number(px) + Number(pw)
    const left = Number(/"left":(\d+)/.exec(json.slice(json.indexOf('"position":"absolute"')))?.[1]) * 8
    // Granularity is one cell (8px): the glow starts within a cell of the pill's edge and shows past it.
    expect(left).toBeGreaterThanOrEqual(pillRight - 8)
    expect(left + 24).toBeGreaterThan(pillRight)
  }
})

test('pane: 200 planned tasks stay under the host bound, with a "+N more planned" line', async ($, on) => {
  setup(on)
  const tasks = Array.from({ length: 200 }, (_, i) => ({ title: `task number ${i + 1}`, tier: 'medium' }))
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Big plan', phase: 'delegate', total: 200, tasks } as never)
  const { nodes, json } = await mount($, 'Pane')
  expect(json.length).toBeLessThan(262_144)
  expect(nodes.filter(n => n.type === 'Text').map(n => n.text ?? '').join('|')).toMatch(/\+\d+ more planned/)
})
