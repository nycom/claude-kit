import { expect, mock, test } from 'claude-code/testing'

const STEP = 'mcp__savvy-progress__step'

test('step flags failed and blocked workers, toasting once per reason', async ($, on) => {
  mock.clock(on)
  // Nothing beneath the plugins draws the band; the engine's base answer is empty.
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))
  on('turn.complete', () => ({ text: '' }))

  const spawn = (description: string) =>
    $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  const step = (agentId: string, extra: Record<string, unknown> = {}) =>
    $.tool.call({ tool: STEP, done: 1, ...extra, agentId } as never)
  // What the terminal pane and band show, as one string.
  const shown = async (component: 'Pane' | 'AbovePrompt') => {
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component, requestId: component === 'Pane' ? 'savvy-agents' : undefined, props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')
    await ui.unmount()
    return text
  }

  await spawn('fix tests')
  await spawn('pick db')

  // Failed attempts: the third flags the card and toasts; the fourth does not toast again.
  await step('w1', { failed: true })
  await step('w1', { failed: true })
  expect(toasts).toEqual([])
  await step('w1', { failed: true })
  expect(await shown('Pane')).toContain('FAILED ×3')
  // No flow, yet the band shows the chip.
  expect(await shown('AbovePrompt')).toContain('⚠ 1 needs attention')
  expect(toasts).toEqual(['agent fix tests: failed 3 times'])
  await step('w1', { failed: true })
  expect(toasts.length).toBe(1)

  // Blocked: set toasts, the same question again does not, a call without it clears it.
  await step('w2', { blocked: '  Postgres or SQLite? ' })
  expect(await shown('Pane')).toContain('NEEDS INPUT')
  expect(await shown('Pane')).toContain('↳ Postgres or SQLite?')
  await step('w2', { blocked: 'Postgres or SQLite?' })
  expect(toasts).toEqual(['agent fix tests: failed 3 times', 'agent pick db: needs input — Postgres or SQLite?'])
  await step('w2')
  expect(await shown('Pane')).not.toContain('NEEDS INPUT')
  // A fresh transition into attention toasts again.
  await step('w2', { blocked: 'Postgres or SQLite?' })
  expect(toasts.length).toBe(3)

  // Finishing the task clears the failed streak; a fresh streak toasts again.
  await step('w1', { done: 3, total: 3 })
  expect(await shown('Pane')).not.toContain('FAILED')
  // A fresh streak toasts again, and sitting at done == total a plain step call does not clear it.
  await step('w1', { failed: true, done: 3 })
  await step('w1', { failed: true, done: 3 })
  await step('w1', { failed: true, done: 3 })
  expect(toasts.length).toBe(4)
  await step('w1', { done: 3, note: 'retrying' })
  expect(await shown('Pane')).toContain('FAILED ×3')

  // Reaching done by lowering total, or by setting it for the first time, also ends the streak.
  await spawn('lower total')
  await spawn('first total')
  for (let i = 0; i < 3; i++) {
    await step('w3', { done: 3, total: 5, failed: true })
    await step('w4', { done: 5, failed: true })
  }
  expect(await shown('Pane')).toContain('lower total| FAILED ×3')
  expect(await shown('Pane')).toContain('first total| FAILED ×3')
  await step('w3', { done: 3, total: 3 })
  await step('w4', { done: 3, total: 3 })
  expect(await shown('Pane')).not.toContain('lower total| FAILED')
  expect(await shown('Pane')).not.toContain('first total| FAILED')
})

const setup = (on: Parameters<Parameters<typeof test>[1]>[1], below = '', toasts: string[] = []) => {
  mock.clock(on)
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [below] }))
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w1' }))
  on('turn.complete', () => ({ text: '' }))
}
const spawnW1 = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'pick db', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
const mountText = async ($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop', component: 'Pane' | 'AbovePrompt') => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component, requestId: component === 'Pane' ? 'savvy-agents' : undefined, props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  const all = await ui.findAll({})
  const text = all.map(n => `${n.text ?? ''}${(n as { props?: { alt?: string } }).props?.alt ?? ''}`).join('|')
  await ui.unmount()
  return text
}

test('an ended worker is no longer flagged: the band chip and the card clear', async ($, on) => {
  setup(on)
  await spawnW1($)
  await $.tool.call({ tool: STEP, done: 1, blocked: 'Postgres or SQLite?', agentId: 'w1' } as never)
  expect(await mountText($, 'terminal', 'AbovePrompt')).toContain('⚠ 1 needs attention')
  expect(await mountText($, 'terminal', 'Pane')).toContain('NEEDS INPUT')

  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 'w1', agentId: 'w1' } as never)
  expect(await mountText($, 'terminal', 'AbovePrompt')).not.toContain('needs attention')
  expect(await mountText($, 'terminal', 'Pane')).not.toContain('NEEDS INPUT')
})

const stepW1 = ($: Parameters<Parameters<typeof test>[1]>[0], extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: STEP, done: 1, total: 4, ...extra, agentId: 'w1' } as never)

test('toasts fire on crossings only: failed at the third, blocked on a new question', async ($, on) => {
  const toasts: string[] = []
  setup(on, '', toasts)
  await spawnW1($)
  for (let i = 0; i < 3; i++) await stepW1($, { failed: true })
  await stepW1($, { blocked: 'Postgres or SQLite?' })
  await stepW1($)
  // Leaving the question does not announce the same failed streak again.
  expect(toasts).toEqual(['agent pick db: failed 3 times', 'agent pick db: needs input — Postgres or SQLite?'])
  // A long question is cut in the toast.
  await stepW1($, { blocked: 'x'.repeat(200) })
  expect(toasts[2]).toBe(`agent pick db: needs input — ${'x'.repeat(119)}…`)
})

test('a step that moves done on ends the failed streak', async ($, on) => {
  setup(on)
  await spawnW1($)
  for (let i = 0; i < 3; i++) await stepW1($, { failed: true })
  expect(await mountText($, 'terminal', 'Pane')).toContain('FAILED ×3')
  await stepW1($, { done: 2 })
  expect(await mountText($, 'terminal', 'Pane')).not.toContain('FAILED')
  // A fresh failure counts from one again.
  await stepW1($, { done: 2, failed: true })
  expect(await mountText($, 'terminal', 'Pane')).not.toContain('FAILED')
})

test('an ended worker drops the failed flag but keeps the count in its meta', async ($, on) => {
  setup(on)
  await spawnW1($)
  for (let i = 0; i < 3; i++) await stepW1($, { failed: true })
  await $.turn.complete({ reason: 'error', answer: '', durationMs: 0, isAborted: false, turnId: 'w1', agentId: 'w1' } as never)
  // The last run ended, so the finished group folded: open it to read the card.
  const pane = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  await $.ui.press({ plugin: 'savvy-progress', key: 'done' })
  await pane.unmount()
  const terminal = await mountText($, 'terminal', 'Pane')
  expect(terminal).not.toContain('FAILED')
  expect(terminal).toContain('failed ×3')
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  const card = (await ui.findAll({ type: 'Svg' })).map(n => String((n as { props: { source: string; alt: string } }).props.source + n.props.alt)).join('')
  expect(card).not.toContain('FAILED')
  expect(card).toContain('error  ·  failed ×3')
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the flag band sits above what the mods beneath draw`, async ($, on) => {
    setup(on, 'other mod')
    await spawnW1($)
    await $.tool.call({ tool: STEP, done: 1, blocked: 'Postgres or SQLite?', agentId: 'w1' } as never)
    const drawn = await mountText($, surface, 'AbovePrompt')
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
    const [band] = await ui.findAll({})
    // The flag row first, then what the mods beneath drew.
    expect(band.children.map(c => c.type)).toEqual(['Box', 'Text'])
    expect(JSON.stringify(band.children[0])).toContain('needs attention')
    expect(band.children[1].children).toEqual(['other mod'])
    await ui.unmount()
  })
}

test('a third failure with a new question in one call toasts both', async ($, on) => {
  const toasts: string[] = []
  setup(on, '', toasts)
  await spawnW1($)
  for (let i = 0; i < 2; i++) await stepW1($, { failed: true })
  await stepW1($, { failed: true, blocked: 'Postgres or SQLite?' })
  expect(toasts).toEqual(['agent pick db: needs input — Postgres or SQLite?', 'agent pick db: failed 3 times'])
})

type Drawn = { type: string; props?: { width?: number; gap?: number; label?: string }; children?: (Drawn | string)[] }
// Cells a terminal row takes: fixed-width boxes by width, text by length, rows add their gaps.
const cells = (n: Drawn | string): number => {
  if (typeof n === 'string') return n.length
  if (n.type === 'Button') return n.props?.label?.length ?? 0
  if (n.props?.width) return n.props.width
  const kids = (n.children ?? []).map(cells)
  return kids.reduce((a, b) => a + b, 0) + (n.props?.gap ?? 0) * Math.max(0, kids.length - 1)
}

test('terminal: the chip and the gap beside it are fully reserved, so a flagged band row is no wider than an unflagged one', async ($, on) => {
  setup(on)
  await spawnW1($)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'ship it', total: 4, done: 1 } as never)
  const rowAt = async (cols: number) => {
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: cols, hasSurvey: false, maxRows: 5 } as never })
    const [band] = await ui.findAll({})
    const row = cells(band.children[0] as unknown as Drawn)
    await ui.unmount()
    return row
  }
  const plain = await rowAt(80)
  await $.tool.call({ tool: STEP, done: 1, blocked: 'Postgres or SQLite?', agentId: 'w1' } as never)
  expect(await rowAt(80)).toBeLessThanOrEqual(plain)
})

test('a second session.start does not stack a second clock ticker', async ($, on) => {
  // Count clock.now reads: the ticker reads it once per second while a worker runs.
  let ticks = 0
  const clock = mock.clock(((event: string, handler: (...args: never[]) => unknown) =>
    on(event as never, event === 'clock.now' ? ((...args: never[]) => (ticks++, handler(...args))) as never : (handler as never))) as typeof on)
  mock.env(on, { HOME: '/home/k' })
  on('fs.stat', () => { throw new Error('ENOENT') })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w1' }))
  const start = () => $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)
  await start()
  await start()
  await spawnW1($)
  ticks = 0
  await clock.advance(3_000)
  expect(ticks).toBe(3)
})
