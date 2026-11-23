import { expect, mock, test } from 'claude-code/testing'

import { briefFor } from '../hooks/register'
import type { $T, OnT } from './drawing'
import { T0 } from './drawing'

const TOOL = 'mcp__savvy-progress__step'
// Today's savvy-* brief, byte for byte; a drift fails here and in defaults.test.ts.
const SAVVY = `

Progress reporting: before any other work, call \`${TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar. When an attempt fails, call it with failed: true, reason (one sentence) and error (the exact error line).`
const ANY = `

Progress reporting (optional): if \`${TOOL}\` is in your tool list, call it before other work with \`total\` (your plan in 3-8 steps) and \`done: 0\`, then again with \`done\` and a few-word \`note\` as each step finishes; it only draws a progress bar. If it is not in your tool list, ignore this paragraph and do not mention it. Use \`failed: true\` (with \`reason\` and \`error\`) only when your own attempt at the task failed and you could not complete it. A result you were asked to produce (review findings, a gate you were told to run that came back red, a failing test you were told to report) is not a failure: put it in your answer.`

const flow = (titles: string[], isFinished = false) =>
  ({ title: 'Ship it', total: titles.length, done: 0, phase: 'delegate', isFinished, tasks: titles.map(title => ({ title, tier: 'medium' })) }) as never
const spawnOf = (o: Record<string, unknown> = {}) =>
  ({ subagentType: 'general-purpose', prompt: 'P', description: 'schema implement', fork: false, ...o }) as never

test('briefFor: every branch', () => {
  const f = flow(['schema', 'api'])
  // savvy-* keeps today's rule in both modes, resume and fork included.
  for (const mode of ['savvy', 'flow', undefined]) {
    expect(briefFor(spawnOf({ subagentType: 'savvy-worker' }), null, mode)).toBe(SAVVY)
    expect(briefFor(spawnOf({ subagentType: 'savvy-worker', resume: { agentId: 'w1' } }), f, mode)).toBe(SAVVY)
    expect(briefFor(spawnOf({ subagentType: 'savvy-worker', fork: true }), f, mode)).toBe(SAVVY)
  }
  expect(briefFor(spawnOf({ subagentType: 'savvy-worker', prompt: `use ${TOOL}` }), f, 'flow')).toBe('')
  // The default and any value but 'flow' never brief another type.
  expect(briefFor(spawnOf(), f, 'savvy')).toBe('')
  expect(briefFor(spawnOf(), f, undefined)).toBe('')
  expect(briefFor(spawnOf(), f, 'x')).toBe('')
  // flow: a description that names a task, by titleOf's prefix rule.
  expect(briefFor(spawnOf(), f, 'flow')).toBe(ANY)
  expect(briefFor(spawnOf({ description: 'schema review c1' }), f, 'flow')).toBe(ANY)
  expect(briefFor(spawnOf({ description: 'Schema' }), f, 'flow')).toBe(ANY)
  expect(briefFor(spawnOf({ description: 'schematic' }), f, 'flow')).toBe('')
  expect(briefFor(spawnOf({ description: 'other work' }), f, 'flow')).toBe('')
  // flow: skipped for resumes, forks, teammates, and a prompt that names the tool.
  expect(briefFor(spawnOf({ resume: { agentId: 'w1' } }), f, 'flow')).toBe('')
  expect(briefFor(spawnOf({ fork: true }), f, 'flow')).toBe('')
  expect(briefFor(spawnOf({ isTeammate: true }), f, 'flow')).toBe('')
  expect(briefFor(spawnOf({ prompt: `call ${TOOL} please` }), f, 'flow')).toBe('')
  // flow: no flow, a finished flow, a flow without tasks.
  expect(briefFor(spawnOf(), null, 'flow')).toBe('')
  expect(briefFor(spawnOf(), flow(['schema'], true), 'flow')).toBe('')
  expect(briefFor(spawnOf(), flow([]), 'flow')).toBe('')
  // A punctuation-only title normalises to '' and matches nothing.
  expect(briefFor(spawnOf({ description: '' }), flow(['---']), 'flow')).toBe('')
  expect(briefFor(spawnOf({ description: '...' }), flow(['---']), 'flow')).toBe('')
})

// Through the hook: what the subagent is spawned with, as the host beneath savvy sees it.
const capture = (on: OnT) => {
  mock.clock(on, { now: T0 })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const prompts: string[] = []
  let n = 0
  on('agent.spawn', (_$, e) => (prompts.push(e.prompt), { model: 'claude-opus-5-5', agentId: `w${++n}` }))
  return prompts
}
const plan = ($: $T, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', total: 2, tasks: [{ title: 'schema', tier: 'medium' }, { title: 'api', tier: 'medium' }], ...extra } as never)
const go = ($: $T, o: Record<string, unknown> = {}) =>
  $.agent.spawn({ tool_use_id: `t${Math.random()}`, prompt: 'P', description: 'schema implement', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false, ...o } as never)

test('default options: a matched non-savvy spawn runs with its prompt unchanged', async ($, on) => {
  const prompts = capture(on)
  await plan($)
  await go($)
  await go($, { subagentType: 'savvy-worker' })
  expect(prompts).toEqual(['P', `P${SAVVY}`])
})

test('stepBrief flow: only a spawn that names a task of the unfinished flow is briefed', { options: { stepBrief: 'flow' } }, async ($, on) => {
  const prompts = capture(on)
  await go($) // no flow yet
  await plan($)
  await go($)
  await go($, { description: 'api review c1' })
  await go($, { description: 'unrelated helper' })
  await go($, { fork: true })
  await go($, { isTeammate: true })
  await go($, { prompt: `P ${TOOL}` })
  await go($, { subagentType: 'savvy-worker' })
  await plan($, { finished: true })
  await go($)
  expect(prompts).toEqual(['P', `P${ANY}`, `P${ANY}`, 'P', 'P', 'P', `P ${TOOL}`, `P${SAVVY}`, 'P'])
})
