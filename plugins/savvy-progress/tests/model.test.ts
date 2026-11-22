import { expect, mock, test } from 'claude-code/testing'
import { modelOf } from '../hooks/register'
import { end, imgOf, PROPS, T0 } from './drawing'
import type { $T, OnT } from './drawing'
import type { AgentRun } from '../types'

const USAGE = { input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// The host answers each model request with the model the request ran on.
const answers = (on: OnT) =>
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: { model: e.model, ...USAGE } } as never
  })
// drawing.ts's host, with spawns answered by these models in order, as a hook answering the
// spawn would; a resume continues under its own id, and once the list runs out the parent's model.
const setup = (on: OnT, ...models: string[]) => {
  mock.clock(on, { now: T0 })
  seen = []
  on('state.get', async (_$, e, next) => {
    const value = await next(e)
    const list = (value as { value?: { value?: unknown } })?.value?.value
    if ((e as { key?: string }).key === 'agents' && Array.isArray(list)) seen = list
    return value
  })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  let n = 0
  on('agent.spawn', (_$, e) => ({
    model: models.shift() ?? e.parentModel,
    agentId: (e as { resume?: { agentId: string } }).resume?.agentId ?? `m${++n}`,
  }))
}
const spawnWith = ($: $T, extra: Record<string, unknown> = {}) =>
  $.agent.spawn({ tool_use_id: `t${Math.random()}`, prompt: '', description: 'pick db', subagentType: 'general-purpose', provider: 'claude', parentModel: 'claude-sonnet-5-5', background: false, fork: false, ...extra } as never)
const request = async ($: $T, agentId: string, model: string, effort?: unknown) => {
  for await (const _ of $.turn.step({ turnId: agentId, index: 0, model, effort, messageCount: 1, agentId } as never)) void _
}
// The agents atom, as the pane's own read of it last saw it.
let seen: AgentRun[] = []
const draw = async ($: $T) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: PROPS } as never)
  const nodes = await ui.findAll({})
  await ui.unmount()
  return nodes
}
const runOf = async ($: $T, agentId: string) => (await draw($), seen.find(a => a.agentId === agentId))

test('modelOf: family, version and the long-window flag from any id shape', () => {
  const table: [string, ReturnType<typeof modelOf>][] = [
    ['claude-opus-5-5', { modelFamily: 'opus', modelVersion: '5.5' }],
    ['claude-sonnet-5', { modelFamily: 'sonnet', modelVersion: '5' }],
    ['claude-opus-4-1-20250805', { modelFamily: 'opus', modelVersion: '4.1' }],
    ['claude-opus-4-20250514', { modelFamily: 'opus', modelVersion: '4' }],
    ['claude-3-5-sonnet-20241022', { modelFamily: 'sonnet', modelVersion: '3.5' }],
    ['claude-3-opus-20240229', { modelFamily: 'opus', modelVersion: '3' }],
    ['claude-opus-5-5[1m]', { modelFamily: 'opus', modelVersion: '5.5', modelLong: true }],
    ['haiku', { modelFamily: 'haiku', modelVersion: '' }],
    ['Fable', { modelFamily: 'fable', modelVersion: '' }],
    ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', { modelFamily: 'sonnet', modelVersion: '4.5' }],
    ['claude-mythos-5-1@20261001', { modelFamily: 'mythos', modelVersion: '5.1' }],
    ['gpt-5', { modelFamily: '', modelVersion: '' }],
    ['', { modelFamily: '', modelVersion: '' }],
  ]
  for (const [id, want] of table) expect([id, modelOf(id)]).toEqual([id, want])
})

test('model: a spawn answered with an alias, then a request with the full id', async ($, on) => {
  setup(on, 'haiku')
  answers(on)
  await spawnWith($)
  expect(await runOf($, 'm1')).toMatchObject({ model: 'haiku', modelFamily: 'haiku', modelVersion: '' })
  await request($, 'm1', 'claude-haiku-5-5', 'low')
  const run = await runOf($, 'm1')
  expect(run).toMatchObject({ model: 'claude-haiku-5-5', modelFamily: 'haiku', modelVersion: '5.5', effort: 'low' })
  expect(run?.modelLong).toBeUndefined()
})

test('model: the resolved id is kept as given, trimmed; inherit or empty falls back to the parent model', async ($, on) => {
  setup(on, '  claude-Opus-5-5[1m] ', 'inherit', '')
  await spawnWith($)
  expect(await runOf($, 'm1')).toMatchObject({ model: 'claude-Opus-5-5[1m]', modelFamily: 'opus', modelVersion: '5.5', modelLong: true })
  await spawnWith($)
  expect(await runOf($, 'm2')).toMatchObject({ model: 'claude-sonnet-5-5', modelFamily: 'sonnet', modelVersion: '5.5' })
  await spawnWith($)
  expect(await runOf($, 'm3')).toMatchObject({ model: 'claude-sonnet-5-5', modelFamily: 'sonnet' })
  // No effort is known before the first request.
  expect((await runOf($, 'm3'))?.effort).toBeUndefined()
})

test('model: a fork runs on the model the spawn resolved, not the call model', async ($, on) => {
  setup(on)
  await spawnWith($, { fork: true, model: 'haiku' })
  expect(await runOf($, 'm1')).toMatchObject({ model: 'claude-sonnet-5-5', modelFamily: 'sonnet', modelVersion: '5.5' })
})

test('model: a resume keeps the earlier model and effort until a request reports new ones', async ($, on) => {
  setup(on, 'claude-opus-5-5', 'haiku')
  answers(on)
  await spawnWith($)
  await request($, 'm1', 'claude-opus-5-5', 'high')
  await end($, 'm1')
  await spawnWith($, { resume: { agentId: 'm1' } })
  expect(await runOf($, 'm1')).toMatchObject({ model: 'claude-opus-5-5', modelFamily: 'opus', modelVersion: '5.5', effort: 'high', status: 'running' })
  await request($, 'm1', 'claude-sonnet-5', 'medium')
  expect(await runOf($, 'm1')).toMatchObject({ model: 'claude-sonnet-5', modelFamily: 'sonnet', modelVersion: '5', effort: 'medium' })
})

test('model: a numeric effort leaves the last level', async ($, on) => {
  setup(on)
  answers(on)
  await spawnWith($)
  await request($, 'm1', 'claude-opus-5-5', 'high')
  await request($, 'm1', 'claude-opus-5-5', 3)
  expect((await runOf($, 'm1'))?.effort).toBe('high')
})

test('model: a run with no steps seen takes the turn model', async ($, on) => {
  setup(on, 'haiku')
  await spawnWith($)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 'm1', agentId: 'm1', usage: { model: 'claude-3-5-haiku-20241022', ...USAGE } } as never)
  expect(await runOf($, 'm1')).toMatchObject({ model: 'claude-3-5-haiku-20241022', modelFamily: 'haiku', modelVersion: '3.5' })
})

test('card: an id in the older order names its version, not its date', async ($, on) => {
  setup(on, 'claude-3-5-sonnet-20241022')
  await spawnWith($)
  const src = (await draw($)).map(n => imgOf<{ source?: string }>(n as never)?.source ?? '').join('\n')
  expect(src).toContain('Sonnet 3.5')
  expect(src).not.toContain('20241022')
})
