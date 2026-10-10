import { expect, mock, test } from 'claude-code/testing'

import { paneFailed } from '../hooks/register'
import { PROPS } from './drawing'
import type { $T, OnT } from './drawing'

// The desktop's Svg constructor throws: a hook drawing an Svg fails mid-draw. Box and Text stay whole.
const breakSvg = (on: OnT) =>
  on('ui.resolve', async (_$, e, next) => ({ ...(await next(e)), Svg: () => { throw new Error('svg exploded') } }) as never)

const textOf = async ($: $T, component: 'Pane' | 'AbovePrompt') => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component, ...(component === 'Pane' ? { requestId: 'savvy-agents' } : {}), props: PROPS })
  const text = (await ui.findAll({})).map(n => n.text ?? '').join('|')
  await ui.unmount()
  return text
}

// The engine's placeholder for a hook that failed names no cause; the pane says what broke.
test('a Pane draw that throws shows the failure, not a blank pane', async ($, on) => {
  mock.clock(on)
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  breakSvg(on)
  const text = await textOf($, 'Pane')
  expect(text).toContain('savvy-progress could not draw this pane: throw: ')
  expect(text).toContain('svg exploded')
})

test('an AbovePrompt draw that throws shows the failure and keeps the bands beneath', async ($, on) => {
  mock.clock(on)
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: ['skins band'] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  breakSvg(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', phase: 'delegate', done: 1, total: 5 } as never)
  const text = await textOf($, 'AbovePrompt')
  expect(text).toContain('savvy-progress could not draw this band: throw: ')
  expect(text).toContain('svg exploded')
  expect(text).toContain('skins band')
})

test('a long failure message is cut to 300 characters', async ($, on) => {
  mock.clock(on)
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.resolve', async (_$, e, next) => ({ ...(await next(e)), Svg: () => { throw new Error('x'.repeat(1000)) } }) as never)
  const text = await textOf($, 'Pane')
  expect(text).toContain('x'.repeat(250))
  expect(text).not.toContain('x'.repeat(301))
})

// Re-entry: the Pane raised again beneath the pane hook's own frame. The hook did not run and
// its `$` calls reject; the handler answers with the failure line, never next(e)'s blank.
test('the Pane catch answers a re-entry with the failure line, touching neither $ nor next', async () => {
  const untouchable = new Proxy({}, { get: () => { throw new Error('$ touched') } })
  const next = Object.assign(() => { throw new Error('next called') }, { error: { kind: 're-entry', budget: 1000 }, called: false })
  const drawn = JSON.stringify(await paneFailed(untouchable as never, untouchable as never, next as never))
  expect(drawn).toContain('savvy-progress could not draw this pane: re-entry')
})

test('the failure line keeps no control character from the error message', async () => {
  const next = Object.assign(() => undefined, { error: { kind: 'throw', message: 'boom \x1b[31mred\x07', budget: 1000 }, called: true })
  const drawn = (await paneFailed({} as never, {} as never, next as never)) as unknown as { children: [{ children: [string] }] }
  const line = drawn.children[0].children[0]
  expect(line).toContain('boom [31mred')
  expect(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(line)).toBe(false)
})
