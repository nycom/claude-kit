import { expect, mock, test } from 'claude-code/testing'

import { end, setup, spawn } from './drawing'
import type { $T } from './drawing'

const CUSTOM = ['build=delegate', 'integrate=close+done', 'notes=close+finish']

const plan = ($: $T) =>
  $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', total: 2, tasks: [{ title: 'a' }, { title: 'b' }] } as never)
const band = async ($: $T) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  const alt = (await ui.findAll({ type: 'Svg' })).map(n => (n as unknown as { props?: { alt?: string } }).props?.alt)[0]
  await ui.unmount()
  return alt
}
const start = ($: $T) => $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)
let published: unknown
const toasts = (on: Parameters<typeof setup>[0]) => {
  published = undefined
  on('state.set', (_$, e, next) => ((e as { key?: string }).key === 'stages' && (published = (e as { value?: unknown }).value), next(e)))
  mock.env(on, { HOME: '/home/k' })
  on('fs.stat', () => { throw new Error('ENOENT') })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  const out: string[] = []
  on('ui.toast', (_$, e) => (out.push(e.text), { value: undefined }))
  return out
}

test('custom stage words move the phase, tick a task and finish the flow', { options: { stages: CUSTOM } }, async ($, on) => {
  setup(on)
  await plan($)
  await spawn($, 'a build') // w1
  expect(await band($)).toBe('Ship it: Tasks 0/2, 0%')
  await spawn($, 'a implement') // w2: no longer a stage word
  await end($, 'w1')
  await end($, 'w2')
  expect(await band($)).toBe('Ship it: Tasks 0/2, 0%')
  await spawn($, 'a integrate') // w3
  await end($, 'w3')
  expect(await band($)).toBe('Ship it: Tasks 1/2, 50%')
  await spawn($, 'b integrate') // w4
  await end($, 'w4')
  await spawn($, 'x notes') // w5
  await end($, 'w5')
  expect(await band($)).toBe('Ship it: Done, 100%')
})

test('under a custom list only its working words take a tick back', { options: { stages: CUSTOM } }, async ($, on) => {
  const clock = setup(on)
  await plan($)
  await spawn($, 'a integrate') // w1
  await end($, 'w1')
  await clock.advance(1_000)
  await spawn($, 'a notes') // w2: +finish
  await spawn($, 'a fix c2') // w3: not a word here
  expect(await band($)).toBe('Ship it: Tasks 1/2, 50%')
  await spawn($, 'a build') // w4
  expect(await band($)).toBe('Ship it: Tasks 0/2, 0%')
})

test('under a custom list the default words move nothing', { options: { stages: CUSTOM } }, async ($, on) => {
  setup(on)
  await plan($)
  await spawn($, 'a review')
  await spawn($, 'a merge')
  await end($, 'w2')
  expect(await band($)).toBe('Ship it: Plan, 0%')
})

test('an entry with an unknown marker is skipped and named', { options: { stages: ['y=review+bogus'] } }, async ($, on) => {
  setup(on)
  const out = toasts(on)
  await start($)
  expect(out.join('\n')).toContain('y=review+bogus')
  expect(published).toEqual([])
})

test('a bad entry is skipped and toasted once, a repeated word keeps the last', { options: { stages: ['build=delegate', 'oops', 'two words=review', 'x=nowhere', 'build=review'] } }, async ($, on) => {
  setup(on)
  const out = toasts(on)
  await start($)
  await plan($)
  await spawn($, 'a build')
  expect(await band($)).toBe('Ship it: Review 0/2, 0%')
  expect(out.filter(t => t.startsWith('savvy-progress: ignored stage entry'))).toHaveLength(1)
  const text = out.join('\n')
  for (const named of ['oops', 'two words=review', 'x=nowhere', 'build=delegate']) expect(text).toContain(named)
  expect(published).toEqual(['build=review'])
})

test('spaces around a marker are trimmed', { options: { stages: ['merge = close + done', 'docs=close+finish '] } }, async ($, on) => {
  setup(on)
  toasts(on)
  await start($)
  expect(published).toEqual(['merge=close+done', 'docs=close+finish'])
})

test('an empty list moves nothing', { options: { stages: [] } }, async ($, on) => {
  setup(on)
  await plan($)
  await spawn($, 'a implement')
  await spawn($, 'a merge')
  await end($, 'w2')
  expect(await band($)).toBe('Ship it: Plan, 0%')
})

test('the default list is published as the stages atom', async ($, on) => {
  setup(on)
  toasts(on)
  await start($)
  expect(published).toEqual([
    'implement=delegate', 'review=review', 'fix=review', 'validate=review', 'recheck=review', 'merge=close+done', 'docs=close+finish',
  ])
})

test('a stages option that is not a list uses the default words', { options: { stages: 'review=review' as never } }, async ($, on) => {
  setup(on)
  await plan($)
  await spawn($, 'a review')
  expect(await band($)).toBe('Ship it: Review 0/2, 0%')
})

test('the ignored-stage toast failing does not skip the registrations', { options: { stages: ['oops'] } }, async ($, on) => {
  setup(on)
  mock.env(on, { HOME: '/home/k' })
  on('fs.stat', () => { throw new Error('ENOENT') })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('tool.register', (_$, e) => (registered.push((e as { name: string }).name), { value: undefined }))
  on('command.register', (_$, e) => (registered.push((e as { name: string }).name), { value: undefined }))
  const out: string[] = []
  on('ui.toast', (_$, e) => {
    out.push(e.text)
    throw new Error('toast down')
  })
  await start($).catch(() => undefined)
  expect(out.filter(t => t.includes('ignored stage entry oops'))).toHaveLength(1)
  expect(registered).toContain('progress')
})
