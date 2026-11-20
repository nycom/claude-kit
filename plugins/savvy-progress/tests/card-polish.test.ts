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
  expect(card(await draw($), 'cache-tax review c1')).toMatch(/ctx \d+% · ≈\$\d+\.\d{2}/)
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
  expect(all).toMatch(/ctx \d+% · ≈\$\d+\.\d{2}/)
})

// The drawn tree as the host gets it, for checking which elements share a row.
type Tree = { type: string; key?: string; props?: Record<string, unknown> & { key?: string; module?: string; props?: Record<string, unknown> }; children?: Tree[] }
const tree = async ($: $T) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: PROPS } as never)
  const drawn = (await ui.drawn()) as unknown as Tree
  await ui.unmount()
  return drawn
}
const walk = (t: Tree, f: (n: Tree) => void) => { f(t); for (const c of t.children ?? []) if (c && typeof c === 'object') walk(c, f) }

test('pane: one summary line replaces the three tiles', async ($, on) => {
  setup(on)
  answers(on)
  await spawn($, 'cache-tax review c1')
  const before = sources(await draw($))
  expect(before).not.toContain('class="tile"')
  expect(before).toContain('>1 running · — · —<')
  await work($, 'w1')
  expect(sources(await draw($))).toMatch(/>1 running · ≈\$\d+\.\d{2} · \d+:\d{2}</)
})

test('pane: the compact toggle sits in the summary row, dim with hover', async ($, on) => {
  setup(on)
  await spawn($, 'cache-tax review c1')
  let row: Tree | undefined
  walk(await tree($), n => {
    const kids = n.children ?? []
    const hasToggle = kids.some(k => k?.props?.module === 'hooks/controls.tsx' && (k.key ?? k.props?.key) === 'compact')
    const hasSummary = kids.some(k => k?.type === 'Svg' && String(k.props?.source ?? '').includes('1 running'))
    if (hasToggle && hasSummary) row = n
  })
  expect(row).toBeDefined()
  const toggle = row?.children?.find(k => k?.props?.module === 'hooks/controls.tsx')
  expect(toggle?.props?.props).toMatchObject({ dim: true })
  expect(typeof toggle?.props?.props?.hover).toBe('string')
})

test('terminal: the pane header prints the same summary text', async ($, on) => {
  setup(on)
  await spawn($, 'cache-tax review c1')
  expect(texts(await draw($, 'terminal'))).toContain('1 running · — · —')
})

const svgW = (src: string) => Number(/<svg[^>]* width="([\d.]+)"/.exec(src)?.[1] ?? NaN)
const narrow = async ($: $T) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 40, hasSurvey: false, maxRows: 5 } } as never)
  const nodes = (await ui.findAll({})) as unknown as Node[]
  await ui.unmount()
  return nodes
}

test('pill draws first and the title follows it', async ($, on) => {
  setup(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  await spawn($, 'asks a question')
  await $.tool.call({ tool: STEP, done: 1, total: 4, blocked: 'which db?', agentId: 'w1' } as never)
  const src = card(await draw($), 'asks a question')
  expect(src).toMatch(/<rect class="r" x="0" y="\d+"/)
  const titleX = Number(/<text class="t" x="([\d.]+)" y="18"[^>]*>asks a question</.exec(src)?.[1])
  expect(titleX).toBeGreaterThan(40)
})

test('at 40 columns every card stays inside its own width', async ($, on) => {
  setup(on)
  await spawn($, 'a rather long task title that has to be cut somewhere')
  await $.tool.call({ tool: STEP, done: 1, total: 4, note: 'a long note about what it does now', agentId: 'w1' } as never)
  const src = card(await narrow($), 'a rather long task title that has to be cut somewhere'.slice(0, 0)) || (await narrow($)).map(n => imgOf(n as never)?.source ?? '').find(s => s.includes('rather long')) || ''
  const W = svgW(src)
  for (const m of src.matchAll(/<text[^>]* x="([\d.]+)"([^>]*)>/g)) {
    const x = Number(m[1])
    if (/text-anchor="end"/.test(m[2] ?? '')) expect(x).toBeLessThanOrEqual(W)
    else expect(x).toBeLessThan(W)
  }
  for (const m of src.matchAll(/<rect[^>]* x="([\d.]+)"[^>]* width="([\d.]+)"/g)) expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(W)
})

test('cards draw crisp 1.5x crabs; planned rows, the compact strip and the band 1x', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Flow', phase: 'delegate', total: 2, tasks: [{ title: 'later task', tier: 'medium' }, { title: 'other later', tier: 'heavy' }] } as never)
  await spawn($, 'now')
  const all = sources(await draw($))
  expect(all).toMatch(/scale\(1\.5\)/)
  expect(all).not.toMatch(/scale\(1\.1\)/)
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: PROPS } as never)
  const band = ((await ui.findAll({})) as unknown as Node[]).map(n => imgOf(n as never)?.source ?? '').join('')
  await ui.unmount()
  expect(band).toMatch(/scale\(1\)/)
})

test('card, planned and background titles share one left edge', async ($, on) => {
  setup(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Flow', phase: 'delegate', total: 2, tasks: [{ title: 'later task', tier: 'medium' }, { title: 'other later', tier: 'heavy' }] } as never)
  await spawn($, 'now')
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as never)
  const nodes = await draw($)
  const srcs = nodes.map(n => imgOf(n as never)?.source ?? '')
  const planned = srcs.find(s => s.includes('later task')) ?? ''
  const bg = srcs.find(s => s.includes('npm run dev')) ?? ''
  const crabCol = Number(/<svg[^>]* width="([\d.]+)"/.exec(srcs.find(s => /class="c-\w+/.test(s) && svgW(s) < 80) ?? '')?.[1])
  expect(Number(/<text class="s" x="([\d.]+)" y="18"/.exec(planned)?.[1])).toBe(crabCol)
  expect(Number(/<text class="t" x="([\d.]+)" y="16"/.exec(bg)?.[1])).toBe(crabCol)
})
