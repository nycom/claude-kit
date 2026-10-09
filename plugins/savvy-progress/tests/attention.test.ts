import { expect, mock, test } from 'claude-code/testing'

const STEP = 'mcp__savvy-progress__step'

test('step flags failed and blocked workers, toasting once per reason', async ($, on) => {
  mock.clock(on)
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
  const end = (agentId: string) => $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: agentId, agentId } as never)
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

  // A respawn leaves a still-running blocked worker flagged...
  await spawn('Pick DB')
  expect(await shown('Pane')).toContain('NEEDS INPUT')
  // ...and supersedes it once that run has ended.
  await end('w2')
  await spawn('pick db')
  expect(await shown('Pane')).not.toContain('NEEDS INPUT')

  // An unnamed run never clears another unnamed run's flag.
  await spawn('...')
  await step('w5', { blocked: 'which env?' })
  await end('w5')
  await spawn('!!!')
  expect(await shown('Pane')).toContain('↳ which env?')

  // Reaching done by lowering total, or by setting it for the first time, also ends the streak.
  await spawn('lower total')
  await spawn('first total')
  for (let i = 0; i < 3; i++) {
    await step('w7', { done: 3, total: 5, failed: true })
    await step('w8', { done: 5, failed: true })
  }
  expect(await shown('Pane')).toContain('lower total| FAILED ×3')
  expect(await shown('Pane')).toContain('first total| FAILED ×3')
  await step('w7', { done: 3, total: 3 })
  await step('w8', { done: 3, total: 3 })
  expect(await shown('Pane')).not.toContain('lower total| FAILED')
  expect(await shown('Pane')).not.toContain('first total| FAILED')
})
