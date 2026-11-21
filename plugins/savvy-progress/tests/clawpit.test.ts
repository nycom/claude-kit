import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

const STEP = 'mcp__savvy-progress__step'

// clawpit publishes its takeover flag; `/takeover on|off` sets it, as clawpit's mod would.
const CLAWPIT: Plugin = {
  name: 'clawpit',
  register(on) {
    on('prompt.submit', async ($, e, next) => {
      if (e.text.startsWith('/takeover ')) await $.state.set({ plugin: 'clawpit', key: 'takeover' } as const, e.text.endsWith('on'))
      return next(e)
    })
  },
}
const takeover = ($: Parameters<Parameters<typeof test>[1]>[0], value: 'on' | 'off') =>
  $.prompt.submit({ text: `/takeover ${value}`, origin: { kind: 'user' }, wait: false } as never)
let agentsSeen: { failNote?: string; failLine?: string; failedAttempts?: number }[] = []

const setup = (on: Parameters<Parameters<typeof test>[1]>[1], opens: string[] = [], registered: { description?: string }[] = [], prompts: string[] = []) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/k' })
  on('fs.stat', () => { throw new Error('ENOENT') })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('state.get', async (_$, e, next) => {
    const value = await next(e)
    if ((e as { key?: string }).key === 'agents') {
      const list = (value as { value?: { value?: unknown } })?.value?.value
      if (Array.isArray(list)) agentsSeen = list
    }
    return value
  })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_$, e) => (opens.push(e.id), { value: { isPlaced: true } }))
  on('tool.register', (_$, e) => (registered.push(e as never), { value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let n = 0
  on('agent.spawn', (_$, e) => (prompts.push(e.prompt), { model: 'claude-opus-5-5', agentId: `w${++n}` }))
}
const spawn = ($: Parameters<Parameters<typeof test>[1]>[0], subagentType = 'general-purpose', prompt = '') =>
  $.agent.spawn({ tool_use_id: `t${Math.random()}`, prompt, description: 'fix tests', subagentType, provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
const step = ($: Parameters<Parameters<typeof test>[1]>[0], extra: Record<string, unknown>) =>
  $.tool.call({ tool: STEP, ...extra, agentId: 'w1' } as never)
// The first run, as the pane's own read of the agents atom last saw it (the pane keeps drawing under takeover).
const run = async ($: Parameters<Parameters<typeof test>[1]>[0]) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  await ui.unmount()
  return agentsSeen[0]
}
const band = async ($: Parameters<Parameters<typeof test>[1]>[0]) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  const text = (await ui.findAll({})).map(n => `${n.type}:${n.text ?? ''}`).join('|')
  await ui.unmount()
  return text
}

test('step: a failed attempt keeps its reason and error line', { plugins: [CLAWPIT] }, async ($, on) => {
  setup(on)
  await spawn($)
  await step($, { done: 2, failed: true, reason: 'Could not reach Postgres on :5432', error: 'connect ECONNREFUSED 127.0.0.1:5432' })
  const r = await run($)
  expect([r.failNote, r.failLine, r.failedAttempts]).toEqual(['Could not reach Postgres on :5432', 'connect ECONNREFUSED 127.0.0.1:5432', 1])
})

test('step: a later failed attempt without a reason keeps the last one', { plugins: [CLAWPIT] }, async ($, on) => {
  setup(on)
  await spawn($)
  await step($, { done: 2, failed: true, reason: 'no db', error: 'ECONNREFUSED' })
  await step($, { done: 2, failed: true })
  const r = await run($)
  expect([r.failNote, r.failLine, r.failedAttempts]).toEqual(['no db', 'ECONNREFUSED', 2])
})

test('step: progress clears the reason and the error line', { plugins: [CLAWPIT] }, async ($, on) => {
  setup(on)
  await spawn($)
  await step($, { done: 2, failed: true, reason: 'no db', error: 'ECONNREFUSED' })
  await step($, { done: 3 })
  const r = await run($)
  expect([r.failNote, r.failLine]).toEqual([undefined, undefined])
})

test('step: control characters and length are bounded', { plugins: [CLAWPIT] }, async ($, on) => {
  setup(on)
  await spawn($)
  await step($, { done: 1, failed: true, reason: `${'x'.repeat(250)}\nsecond\x1b[0m line ${'y'.repeat(250)}`, error: 'e'.repeat(500) })
  const r = await run($)
  expect(r.failNote).not.toMatch(/[\x00-\x1f\x7f-\x9f]/)
  expect(r.failNote!.length).toBeLessThanOrEqual(200)
  expect(r.failLine!.length).toBeLessThanOrEqual(300)
})

test('step: the tool description and the brief ask for reason and error', { plugins: [CLAWPIT] }, async ($, on) => {
  const registered: { name?: string; description?: string }[] = []
  const prompts: string[] = []
  setup(on, [], registered, prompts)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)
  const ask = 'When an attempt fails, call it with failed: true, reason (one sentence) and error (the exact error line).'
  expect(registered.find(t => t.name === 'step')?.description).toContain(ask)
  await spawn($, 'savvy-careful')
  expect(prompts[0]).toContain(ask)
})

test('takeover: with the clawpit atom true the band draws nothing of savvy and the pane does not auto-open', { plugins: [CLAWPIT] }, async ($, on) => {
  const opens: string[] = []
  setup(on, opens)
  await takeover($, 'on')
  await spawn($)
  await step($, { done: 1, failed: true })
  await step($, { done: 1, failed: true })
  await step($, { done: 1, failed: true })
  expect(await band($)).not.toMatch(/agent|attention/)
  expect(opens).toEqual([])
  // Tools and atoms keep working.
  expect((await run($)).failedAttempts).toBe(3)
})

test('takeover: with the atom unset savvy draws as before', { plugins: [CLAWPIT] }, async ($, on) => {
  const opens: string[] = []
  setup(on, opens)
  await spawn($)
  await step($, { done: 1, failed: true })
  await step($, { done: 1, failed: true })
  await step($, { done: 1, failed: true })
  expect(await band($)).toMatch(/1 agent/)
  expect(opens).toEqual(['savvy-agents'])
})

test('takeover: autoOpen stands down on both of its paths, a new plan and a subagent spawn', { plugins: [CLAWPIT] }, async ($, on) => {
  const opens: string[] = []
  setup(on, opens)
  await takeover($, 'on')
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'ship it', phase: 'delegate', total: 2, done: 0, tasks: [{ title: 'fix tests', tier: 'sonnet' }] } as never)
  expect(opens).toEqual([])
  await spawn($)
  expect(opens).toEqual([])
  await takeover($, 'off')
  await spawn($)
  expect(opens).toEqual(['savvy-agents'])
})
