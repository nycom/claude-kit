import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]
type Surface = 'terminal' | 'desktop'

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
  on('classic.Stop', () => ({}))
  on('classic.SessionStart', () => ({}))
  let task = 0
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `b${++task}` } }))
  return clock
}
const spawn = ($: $T, description: string, subagentType = 'general-purpose') =>
  $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType, provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
const end = ($: $T, agentId: string) =>
  $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: agentId, agentId } as never)
const bash = ($: $T, command: string) => $.tool.call({ tool: 'Bash', command, run_in_background: true } as never)
const finish = ($: $T, id: string) =>
  $.prompt.submit({
    text: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>`,
    origin: { kind: 'task-notification' },
    wait: false,
  } as never)

type Node = { type: string; key?: string; text?: string; props?: { key?: string; alt?: string; source?: string; width?: number; height?: number } }
const mount = ($: $T, surface: Surface) =>
  $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: PROPS })

// What the pane draws, leaf by leaf and in order: each Text, Button and Svg (its alt), no Box.
const leaves = async ($: $T, surface: Surface) => {
  const ui = await mount($, surface)
  const nodes = (await ui.findAll({})) as unknown as Node[]
  await ui.unmount()
  return nodes.filter(n => n.type !== 'Box')
}
const labelOf = (n: Node) => `${n.text ?? ''}${n.props?.alt ?? ''}`

// A tree the remote surface can draw: every drawing has markup and a finite size, no key repeats.
const expectDrawable = (nodes: Node[]) => {
  for (const n of nodes.filter(n => n.type === 'Svg')) {
    expect(n.props?.source?.startsWith('<svg')).toBe(true)
    expect(n.props?.alt).toBeTruthy()
    expect(Number.isFinite(n.props?.width) && (n.props?.width ?? 0) > 0).toBe(true)
    expect(Number.isFinite(n.props?.height) && (n.props?.height ?? 0) > 0).toBe(true)
  }
  const keys = nodes.map(n => n.props?.key ?? n.key).filter(Boolean)
  expect(new Set(keys).size).toBe(keys.length)
}

test('desktop pane with no agents: the header, the toggle and the empty line, nothing else', async ($, on) => {
  setup(on)
  const nodes = await leaves($, 'desktop')
  expect(nodes.map(n => n.type)).toEqual(['Svg', 'Button', 'Text'])
  expect(nodes[2]?.text).toBe('No subagents yet.')
  expectDrawable(nodes)
})

test('desktop pane with only ended agents and the Ended group collapsed: the header and the toggle', async ($, on) => {
  setup(on)
  await spawn($, 'fix tests')
  await end($, 'w1')
  const nodes = await leaves($, 'desktop')
  expect(nodes.map(n => n.type)).toEqual(['Svg', 'Button', 'Button'])
  expect(nodes[2]?.text).toBe('▸ Ended · 1')
  expectDrawable(nodes)
})

test('desktop pane with only ended background rows: the toggle opens them, collapsing leaves the header', async ($, on) => {
  setup(on)
  await bash($, 'npm run build')
  await finish($, 'b1')
  const open = await leaves($, 'desktop')
  expect(open.map(n => n.type)).toEqual(['Svg', 'Button', 'Button', 'Svg'])
  expect(open[2]?.text).toBe('▾ Ended · 1')
  expect(labelOf(open[3] as Node)).toContain('npm run build')
  expectDrawable(open)

  const ui = await mount($, 'desktop')
  await $.ui.press({ plugin: 'savvy-progress', key: 'done' })
  await ui.unmount()
  const folded = await leaves($, 'desktop')
  expect(folded.map(n => n.type)).toEqual(['Svg', 'Button', 'Button'])
  expectDrawable(folded)
})

// Running first, then what is planned, then background work, and the Ended group last of all.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface} pane order: running, Planned, Background, Ended (agents, then background rows)`, async ($, on) => {
    setup(on)
    await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', phase: 'delegate', done: 0, total: 3, tasks: [{ title: 'write docs', tier: 'light' }] } as never)
    await spawn($, 'old agent')
    await spawn($, 'live agent')
    await end($, 'w1')
    await bash($, 'old build')
    await finish($, 'b1')
    await bash($, 'live server')

    const labels = (await leaves($, surface)).map(labelOf)
    const at = (word: string) => labels.findIndex(l => l.includes(word))
    const order = ['Running · 1', 'live agent', 'Planned · 1', 'write docs', 'Background · 1', 'live server', 'Ended · 2', 'old agent', 'old build']
    expect(order.map(at).every(i => i >= 0)).toBe(true)
    expect(order.map(at)).toEqual(order.map(at).sort((a, b) => a - b))
    // The terminal's Text leaves also nest their children, so check the headings alone on both.
    const heads = order.filter(w => / · \d$/.test(w))
    expect(heads.map(at)).toEqual(heads.map(at).sort((a, b) => a - b))
  })
}

// A running agent's mark is a 33⅓ platter: a faint ring, a marker that turns with its trail, a fixed spindle.
test('desktop: a running agent draws a turning platter in its tier colour, each card out of phase', async ($, on) => {
  setup(on)
  await spawn($, 'fix tests', 'savvy-heavy')
  await spawn($, 'write docs', 'savvy-heavy')
  const cards = (await leaves($, 'desktop')).filter(n => n.type === 'Svg').map(n => n.props?.source ?? '')
  const platters = cards.map(src => src.match(/<g fill="(#\w+)"><circle [^>]*opacity=".3"\/><g class="spin" style="[^"]*animation-delay:([^;"]+)/)).filter(Boolean)
  expect(platters.length).toBe(2)
  expect(platters.map(m => m?.[1])).toEqual(['#D85A30', '#D85A30'])
  expect(new Set(platters.map(m => m?.[2])).size).toBe(2)
  expect(cards[0]).toContain('.spin{animation:spin 1.8s linear infinite}@keyframes spin{to{transform:rotate(1turn)}}')
  expect(cards[0]).toContain('@media (prefers-reduced-motion: reduce){.spin{animation:none!important}}')
  expect(cards.join('')).not.toContain('class="live"')

  const ui = await mount($, 'desktop')
  await $.ui.press({ plugin: 'savvy-progress', key: 'compact' })
  const compact = (await ui.findAll({ type: 'Svg' })) as unknown as Node[]
  await ui.unmount()
  expect(compact[0]?.props?.source?.match(/<g class="spin"/g)?.length).toBe(2)
})

test("terminal: a running agent's mark turns one quadrant a second with the clock", async ($, on) => {
  const clock = setup(on)
  await spawn($, 'fix tests')
  const SPIN = '◴◷◶◵'
  const mark = async () => (await leaves($, 'terminal')).map(n => n.text ?? '').find(t => t.length === 1 && SPIN.includes(t)) ?? ''
  const first = await mark()
  expect(first).not.toBe('')
  await clock.advance(1_000)
  expect(await mark()).toBe(SPIN[(SPIN.indexOf(first) + 1) % 4])
})

// Each redraw is a new image that starts its animations over: the delay carries the turn on from the wall clock.
test('desktop: a redraw a second later carries each platter on by a second, background rows too; reduced motion still holds it', async ($, on) => {
  const clock = setup(on)
  await spawn($, 'fix tests')
  await bash($, 'npm run dev')
  const draw = async () => {
    const src = (await leaves($, 'desktop')).filter(n => n.type === 'Svg').map(n => n.props?.source ?? '').join('')
    expect(src).toContain('@media (prefers-reduced-motion: reduce){.spin{animation:none!important}}')
    return [...src.matchAll(/class="spin" style="[^"]*animation-delay:-([\d.]+)s/g)].map(m => Number(m[1]))
  }
  const before = await draw()
  await clock.advance(1_000)
  const after = await draw()
  expect(before.length).toBe(2)
  expect(after.map((d, k) => Math.round((((d - (before[k] ?? 0)) % 1.8) + 1.8) % 1.8 * 1000))).toEqual([1000, 1000])
})

// A planned task starts when an agent's description is its title or begins with it as a whole word.
const plan = ($: $T, ...titles: string[]) =>
  $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', phase: 'delegate', done: 0, total: titles.length, tasks: titles.map(title => ({ title, tier: 'light' })) } as never)
const planned = async ($: $T) => {
  const labels = (await leaves($, 'terminal')).map(labelOf)
  return { head: labels.find(l => l.startsWith('Planned')), rows: labels.filter(l => /\d\. kit/.test(l)) }
}

test('a planned task leaves Planned when an agent whose description starts with its title spawns', async ($, on) => {
  setup(on)
  await plan($, 'kit-pr2')
  expect((await planned($)).head).toBe('Planned · 1')
  await spawn($, 'kit-pr2 implement')
  const labels = (await leaves($, 'terminal')).map(labelOf)
  expect(labels.some(l => l.startsWith('Planned'))).toBe(false)
  expect(labels.some(l => l.includes('Running · 1'))).toBe(true)
  expect(labels.some(l => l.includes('kit-pr2 implement'))).toBe(true)
})

test('the longest matching title owns the agent: "kit-pr2 review" starts kit-pr2, not kit', async ($, on) => {
  setup(on)
  await plan($, 'kit', 'kit-pr2')
  await spawn($, 'kit-pr2 review c1')
  const p = await planned($)
  expect(p.head).toBe('Planned · 1')
  expect(p.rows.length).toBeGreaterThan(0)
  expect(p.rows.some(r => r.includes('1. kit '))).toBe(true)
  expect(p.rows.some(r => r.includes('kit-pr2'))).toBe(false)
})

test('a title is a whole word: "kit-pr2x implement" does not start "kit-pr2"', async ($, on) => {
  setup(on)
  await plan($, 'kit-pr2')
  await spawn($, 'kit-pr2x implement')
  expect((await planned($)).head).toBe('Planned · 1')
})

test('a respawn with the identical description is still round 2', async ($, on) => {
  setup(on)
  await plan($, 'kit-pr2')
  await spawn($, 'kit-pr2 implement')
  await $.agent.spawn({ tool_use_id: 'again', prompt: '', description: 'kit-pr2 implement', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  const labels = (await leaves($, 'terminal')).map(labelOf)
  expect(labels.some(l => l.includes('Running · 2'))).toBe(true)
})
