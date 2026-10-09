import { expect, mock, test } from 'claude-code/testing'

const STEP = 'mcp__savvy-progress__step'

test('step flags failed and blocked workers, toasting once per reason', async ($, on) => {
  mock.clock(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))

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
  await step('w1', { failed: true })
  await step('w1', { failed: true })
  await step('w1', { failed: true })
  expect(toasts.length).toBe(4)

  // A new run of the same task supersedes the blocked one.
  await spawn('Pick DB')
  expect(await shown('Pane')).not.toContain('NEEDS INPUT')
})
