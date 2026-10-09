import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]
type Surface = 'terminal' | 'desktop'

const T0 = Date.UTC(2026, 9, 9, 12, 2, 0)
const PROPS = { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never

const setup = (on: OnT) => {
  mock.clock(on, { now: T0 })
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
}
const spawn = ($: $T, description: string) =>
  $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
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
