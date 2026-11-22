import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import { imgOf, PROPS, setup } from './drawing'
import type { $T, OnT } from './drawing'

const ASK = { tool: 'AskUserQuestion', questions: [{ question: '  Which\n database? ', header: 'db', options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }] }

// The need atom as READER last read it.
let seen: unknown = undefined

// The host answers AskUserQuestion only once the test opens the gate, so a test can look while
// the dialog is up; every call and toast the host received is kept.
const host = (on: OnT) => {
  setup(on)
  const calls: unknown[] = []
  const toasts: string[] = []
  let open = () => {}
  let reached = () => {}
  let isReached = new Promise<void>(r => (reached = r))
  on('ui.toast', (_$, e) => (e.text.startsWith('need:') ? (seen = (JSON.parse(e.text.slice(5)) as { value?: unknown }).value ?? null) : toasts.push(e.text), { value: undefined }))
  on('classic.SessionStart', () => ({}))
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    calls.push(e)
    const gate = new Promise<void>(r => (open = r))
    reached()
    await gate
    return { result: { answers: {} } } as never
  })
  // Starts a call and resolves once the dialog is up; `answer` ends it.
  const ask = async (call: Promise<unknown>) => {
    await isReached
    isReached = new Promise<void>(r => (reached = r))
    return {
      answer: async () => {
        open()
        await call.catch(() => undefined)
      },
    }
  }
  return { calls, toasts, ask }
}
// Reads savvy's need atom as another mod would, and hands it to the test in a toast.
const READER: Plugin = {
  name: 'reader',
  register(on) {
    on('prompt.submit', async ($, e, next) => {
      if (e.text === 'read need') $.ui.toast(`need:${JSON.stringify(await $.state.get({ plugin: 'savvy-progress', key: 'need' } as never))}`)
      return next(e)
    })
  },
}
const needOf = async ($: $T) => {
  await $.prompt.submit({ text: 'read need', origin: { kind: 'task-notification' }, wait: false } as never)
  return seen
}

type Node = { type: string; text?: string; props?: { alt?: string; source?: string; module?: string; props?: { source?: string; alt?: string } } }
const drawn = async ($: $T, component: 'Pane' | 'AbovePrompt', surface: 'desktop' | 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component, requestId: component === 'Pane' ? 'savvy-agents' : undefined, props: PROPS } as never)
  const nodes = (await ui.findAll({})) as unknown as Node[]
  await ui.unmount()
  return [...nodes.map(n => `${imgOf(n as never)?.source ?? ''}${imgOf(n as never)?.alt ?? ''}`), ...nodes.filter(n => n.type === 'Text').map(n => n.text ?? '')].join('|')
}

for (const mode of ['unasked', 'off', 'tool'] as const)
  test(`${mode}: an AskUserQuestion call sets no need and toasts nothing`, { options: { sessionNeed: mode }, plugins: [READER] }, async ($, on) => {
    const h = host(on)
    const call = $.tool.call(ASK as never)
    const dialog = await h.ask(call)
    expect(await needOf($)).toBe(null)
    expect(h.calls).toEqual([expect.objectContaining({ questions: ASK.questions })])
    await dialog.answer()
    expect(await needOf($)).toBe(null)
    expect(h.toasts).toEqual([])
  })

// What a session registers, as tests/defaults.test.ts records it.
const registrations = async ($: $T, on: OnT) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/k' })
  const reg: unknown[] = []
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('tool.register', (_$, e) => (reg.push(e), { value: undefined }))
  on('command.register', (_$, e) => (reg.push(e), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/w', source: 'startup' } as never)
  return JSON.stringify(reg)
}
// The default (unasked) is pinned to main by tests/defaults.test.ts; off registers the same.
let unaskedReg = ''
test('unasked: the registrations, recorded', async ($, on) => {
  unaskedReg = await registrations($, on)
  expect(unaskedReg).toContain('"name":"progress"')
})
test('off: the registrations equal the default ones', { options: { sessionNeed: 'off' } }, async ($, on) => {
  expect(await registrations($, on)).toBe(unaskedReg)
})

for (const mode of ['ask', 'both'] as const)
  test(`${mode}: the main session's question is the need while its dialog is up, and toasts once`, { options: { sessionNeed: mode }, plugins: [READER] }, async ($, on) => {
    const h = host(on)
    const dialog = await h.ask($.tool.call(ASK as never))
    expect(await needOf($)).toEqual({ text: 'Which database?', since: expect.any(Number), source: 'ask' })
    expect(h.toasts).toEqual(['needs input — Which database?'])
    await dialog.answer()
    expect(await needOf($)).toBe(null)
  })

test('ask: the question is clipped to 300 characters, the toast to 120', { options: { sessionNeed: 'ask' }, plugins: [READER] }, async ($, on) => {
  const h = host(on)
  const long = 'x'.repeat(400)
  const dialog = await h.ask($.tool.call({ ...ASK, questions: [{ ...ASK.questions[0], question: long }] } as never))
  expect(((await needOf($)) as { text: string }).text).toBe(`${'x'.repeat(299)}…`)
  expect(h.toasts).toEqual([`needs input — ${'x'.repeat(119)}…`])
  await dialog.answer()
})

// Another mod asks the person something through the engine's dialog when it hears "setup".
const ASKER: Plugin = {
  name: 'asker',
  register(on) {
    on('prompt.submit', async ($, e, next) => {
      if (e.text === 'setup') await $.ui.ask('Turn it on?', ['Yes', 'No']).catch(() => undefined)
      return next(e)
    })
  },
}
test('ask: a dialog another plugin raised is not a need', { options: { sessionNeed: 'ask' }, plugins: [ASKER, READER] }, async ($, on) => {
  const h = host(on)
  const dialog = await h.ask($.prompt.submit({ text: 'setup', wait: false, origin: { kind: 'task-notification' } } as never))
  expect(h.calls).toHaveLength(1)
  expect(await needOf($)).toBe(null)
  expect(h.toasts).toEqual([])
  await dialog.answer()
})

test("ask: a subagent's question is not the session's need", { options: { sessionNeed: 'ask' }, plugins: [READER] }, async ($, on) => {
  const h = host(on)
  const dialog = await h.ask($.tool.call({ ...ASK, agentId: 'w1' } as never))
  expect(await needOf($)).toBe(null)
  expect(h.toasts).toEqual([])
  await dialog.answer()
})

test('ask: the person\'s own prompt clears the need, a task notification does not', { options: { sessionNeed: 'ask' }, plugins: [READER] }, async ($, on) => {
  const h = host(on)
  const dialog = await h.ask($.tool.call(ASK as never))
  await $.prompt.submit({ text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' }, wait: false } as never)
  expect(await needOf($)).not.toBe(null)
  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' }, wait: false } as never)
  expect(await needOf($)).toBe(null)
  await dialog.answer()
})

test('ask: a compaction keeps the need, a new session clears it', { options: { sessionNeed: 'ask' }, plugins: [READER] }, async ($, on) => {
  const h = host(on)
  const dialog = await h.ask($.tool.call(ASK as never))
  await $.classic.SessionStart({ source: 'compact' })
  expect(await needOf($)).not.toBe(null)
  await $.classic.SessionStart({ source: 'resume' })
  expect(await needOf($)).toBe(null)
  await dialog.answer()
})

test('ask: with no flow and no agents the band counts the need and the pane leads with its flag line', { options: { sessionNeed: 'ask' }, plugins: [READER] }, async ($, on) => {
  const h = host(on)
  expect(await drawn($, 'AbovePrompt', 'desktop')).not.toContain('needs attention')
  const dialog = await h.ask($.tool.call(ASK as never))
  for (const surface of ['desktop', 'terminal'] as const) {
    expect(await drawn($, 'AbovePrompt', surface)).toContain('⚠ 1 needs attention')
    const pane = await drawn($, 'Pane', surface)
    expect(pane).toContain('Needs input')
    expect(pane).toContain('Claude — Which database?')
  }
  await dialog.answer()
  expect(await drawn($, 'AbovePrompt', 'desktop')).not.toContain('needs attention')
  expect(await drawn($, 'Pane', 'terminal')).not.toContain('Needs input')
})
