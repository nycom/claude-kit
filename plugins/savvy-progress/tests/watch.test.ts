import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import { PROPS, setup } from './drawing'
import type { $T, OnT } from './drawing'

// plan.md: three top-level tasks, one checked; the indented box is a detail of api.
const PLAN_MD = '# Release prep\n\nSome notes.\n\n- [x] schema\n- [ ] api\n  - [x] api detail\n- [ ] docs page\n'
// status.yaml: one block holds configured words; the other blocks are not status maps.
const STATUS_YAML = '# Team board\nproject: demo\nitems:\n  schema: finished\n  api: building\n  docs-page: dropped\n  search: waiting # later\nnotes:\n  owner: someone\n'
const WORDS = ['finished=done', 'dropped=skip', 'building=review']

// The atom READER last read.
let seen: unknown

// The host: a session in /w, files served from `files` (a missing one rejects), Edit and Write answered.
const host = (on: OnT, files: Record<string, string>, cwd: string | null = '/w') => {
  setup(on)
  const reads: string[] = []
  const probes: string[] = []
  const cwds: string[] = []
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    const text = files[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.exists', (_$, e) => (probes.push(e.path), { value: e.path in files }))
  on('session.cwd', () => {
    cwds.push('cwd')
    if (cwd === null) throw new Error('no session directory')
    return { value: cwd }
  })
  const h = { files, reads, probes, cwds, isFailing: false }
  on('tool.call', { tool: ['Edit', 'Write'] }, () => (h.isFailing ? { result: 'no match', isError: true } : { result: 'written' }) as never)
  on('ui.toast', (_$, e) => (e.text.startsWith('atom:') && (seen = (JSON.parse(e.text.slice(5)) as { value?: unknown }).value ?? null), { value: undefined }))
  return h
}
const edit = ($: $T, file_path: string, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', ...extra } as never)

const band = async ($: $T) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const alt = (await ui.findAll({ type: 'Svg' })).map(n => (n as unknown as { props?: { alt?: string } }).props?.alt)[0]
  await ui.unmount()
  return alt
}

// Reads one of savvy's atoms as another mod would, and hands it to the test in a toast.
const READER: Plugin = {
  name: 'reader',
  register(on) {
    on('prompt.submit', async ($, e, next) => {
      if (e.text === 'read flow') $.ui.toast(`atom:${JSON.stringify(await $.state.get({ plugin: 'savvy-progress', key: 'flow' } as never))}`)
      if (e.text === 'read panel') $.ui.toast(`atom:${JSON.stringify(await $.state.get({ plugin: 'savvy-progress', key: 'panel' } as never))}`)
      return next(e)
    })
  },
}
const atomOf = async ($: $T, key: 'flow' | 'panel') => {
  seen = undefined
  await $.prompt.submit({ text: `read ${key}`, origin: { kind: 'task-notification' }, wait: false } as never)
  return seen as Record<string, unknown> | null
}

const start = ($: $T, on: OnT) => {
  mock.env(on, { HOME: '/home/k' })
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  return $.session.start({ cwd: '/w', source: 'startup' } as never)
}

test('an Edit of a watched file builds the flow from its checkboxes', { options: { watch: ['docs/plan.md'] }, plugins: [READER] }, async ($, on) => {
  host(on, { '/w/docs/plan.md': PLAN_MD })
  expect(await edit($, '/w/docs/plan.md')).toEqual({ result: 'written' })
  expect(await band($)).toBe('Release prep: Tasks 1/3, 33%')
  const f = await atomOf($, 'flow')
  expect(f).toMatchObject({ title: 'Release prep', total: 3, done: 1, phase: 'delegate', isFinished: false, source: '/w/docs/plan.md', doneTitles: ['schema'] })
  expect((f?.tasks as { title: string }[]).map(t => t.title)).toEqual(['schema', 'api', 'docs page'])
  // A file flow does not open the agents panel (an auto-open records the flow's title here).
  expect((await atomOf($, 'panel'))?.autoOpenedFor ?? '').toBe('')
})

test('a file with no heading takes its base name; a Write is watched too', { options: { watch: ['/w/**/todo.md'] } }, async ($, on) => {
  host(on, { '/w/a/b/todo.md': '- [ ] one\n- [ ] two\n' })
  await $.tool.call({ tool: 'Write', file_path: '/w/a/b/todo.md', content: '' } as never)
  expect(await band($)).toBe('todo.md: Plan, 0%')
})

test('an unwatched path, a subagent edit and an errored call change nothing', { options: { watch: ['docs/plan.md'] }, plugins: [READER] }, async ($, on) => {
  const h = host(on, { '/w/docs/plan.md': PLAN_MD, '/w/docs/other.md': PLAN_MD })
  await edit($, '/w/docs/other.md')
  await edit($, '/w/docs/plan.md', { agentId: 'w9' })
  expect(await atomOf($, 'flow')).toBe(null)
  h.isFailing = true
  expect(await edit($, '/w/docs/plan.md')).toEqual({ result: 'no match', isError: true })
  expect(await atomOf($, 'flow')).toBe(null)
  expect(h.reads).toEqual([])
})

test('the globs: ** spans directories, * and ? stay inside one segment', { options: { watch: ['/w/**/tasks-?.md', '/w/one/*.txt'] }, plugins: [READER] }, async ($, on) => {
  const box = '- [ ] x\n'
  const h = host(on, { '/w/tasks-1.md': box, '/w/a/b/tasks-2.md': box, '/w/a/tasks-12.md': box, '/w/one/n.txt': box, '/w/one/two/n.txt': box, '/w/tasks-1.mdx': box })
  for (const p of ['/w/a/tasks-12.md', '/w/one/two/n.txt', '/w/tasks-1.mdx']) await edit($, p)
  expect(h.reads).toEqual([])
  for (const p of ['/w/tasks-1.md', '/w/a/b/tasks-2.md', '/w/one/n.txt']) await edit($, p)
  expect(h.reads).toEqual(['/w/tasks-1.md', '/w/a/b/tasks-2.md', '/w/one/n.txt'])
})

test('unchecking a box keeps done', { options: { watch: ['docs/plan.md'] }, plugins: [READER] }, async ($, on) => {
  const h = host(on, { '/w/docs/plan.md': PLAN_MD })
  await edit($, '/w/docs/plan.md')
  h.files['/w/docs/plan.md'] = PLAN_MD.replace('[x] schema', '[ ] schema')
  await edit($, '/w/docs/plan.md')
  expect(await band($)).toBe('Release prep: Tasks 1/3, 33%')
  expect((await atomOf($, 'flow'))?.doneTitles).toEqual(['schema'])
  // A title checked earlier stays known when another box is checked.
  h.files['/w/docs/plan.md'] = PLAN_MD.replace('[x] schema', '[ ] schema').replace('[ ] api', '[x] api')
  await edit($, '/w/docs/plan.md')
  expect((await atomOf($, 'flow'))?.doneTitles).toEqual(['schema', 'api'])
})

test('a file with CRLF line endings builds the same flow', { options: { watch: ['docs/plan.md'] }, plugins: [READER] }, async ($, on) => {
  host(on, { '/w/docs/plan.md': PLAN_MD.replaceAll('\n', '\r\n') })
  await edit($, '/w/docs/plan.md')
  expect(await atomOf($, 'flow')).toMatchObject({ title: 'Release prep', total: 3, done: 1 })
})

test('nested boxes: only the shallowest indent counts', { options: { watch: ['docs/plan.md'] }, plugins: [READER] }, async ($, on) => {
  host(on, { '/w/docs/plan.md': '## Steps\n  * [ ] schema\n      + [x] field one\n      + [x] field two\n  * [X] api\n' })
  await edit($, '/w/docs/plan.md')
  const f = await atomOf($, 'flow')
  expect((f?.tasks as { title: string }[]).map(t => t.title)).toEqual(['schema', 'api'])
  expect(f).toMatchObject({ total: 2, done: 1 })
})

test('titles are cut to 120 characters and at most 200 tasks are kept', { options: { watch: ['docs/plan.md'] }, plugins: [READER] }, async ($, on) => {
  host(on, { '/w/docs/plan.md': `- [ ] ${'t'.repeat(150)}\n${Array.from({ length: 250 }, (_, i) => `- [ ] task ${i}`).join('\n')}` })
  await edit($, '/w/docs/plan.md')
  const f = await atomOf($, 'flow')
  expect(f?.total).toBe(200)
  expect((f?.tasks as { title: string }[])[0]?.title).toBe(`${'t'.repeat(119)}…`)
})

test('all checked finishes the flow, a new unchecked box reopens it', { options: { watch: ['docs/plan.md'] }, plugins: [READER] }, async ($, on) => {
  const h = host(on, { '/w/docs/plan.md': PLAN_MD.replaceAll('[ ]', '[x]') })
  await edit($, '/w/docs/plan.md')
  expect(await band($)).toBe('Release prep: Done, 100%')
  expect(await atomOf($, 'flow')).toMatchObject({ isFinished: true, phase: 'close', done: 3 })
  h.files['/w/docs/plan.md'] = `${PLAN_MD.replaceAll('[ ]', '[x]')}- [ ] search\n`
  await edit($, '/w/docs/plan.md')
  expect(await band($)).toBe('Release prep: Tasks 3/4, 75%')
  expect(await atomOf($, 'flow')).toMatchObject({ isFinished: false, total: 4 })
})

test('a live progress flow is not replaced; once finished, a file flow takes over', { options: { watch: ['docs/plan.md'] } }, async ($, on) => {
  host(on, { '/w/docs/plan.md': PLAN_MD })
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', total: 2, tasks: [{ title: 'a' }, { title: 'b' }] } as never)
  await edit($, '/w/docs/plan.md')
  expect(await band($)).toBe('Ship it: Plan, 0%')
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', finished: true } as never)
  await edit($, '/w/docs/plan.md')
  expect(await band($)).toBe('Release prep: Tasks 1/3, 33%')
  // A progress call with a new title replaces a file flow.
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Next', total: 1 } as never)
  expect(await band($)).toBe('Next: Plan, 0%')
})

test('an earlier pattern outranks a later one; a later file replaces a finished one', { options: { watch: ['docs/summary.md', 'docs/items/*.md'] } }, async ($, on) => {
  const h = host(on, { '/w/docs/summary.md': '# Summary\n- [ ] schema\n- [ ] api\n', '/w/docs/items/api.md': '# Api\n- [x] route\n- [ ] test\n', '/w/docs/items/ui.md': '# Ui\n- [ ] page\n' })
  await edit($, '/w/docs/items/api.md')
  expect(await band($)).toBe('Api: Tasks 1/2, 50%')
  // Another file of the same entry does not take over an unfinished one.
  await edit($, '/w/docs/items/ui.md')
  expect(await band($)).toBe('Api: Tasks 1/2, 50%')
  await edit($, '/w/docs/summary.md')
  expect(await band($)).toBe('Summary: Plan, 0%')
  await edit($, '/w/docs/items/api.md')
  expect(await band($)).toBe('Summary: Plan, 0%')
  // The same source updates.
  h.files['/w/docs/summary.md'] = '# Summary\n- [x] schema\n- [x] api\n'
  await edit($, '/w/docs/summary.md')
  expect(await band($)).toBe('Summary: Done, 100%')
  await edit($, '/w/docs/items/api.md')
  expect(await band($)).toBe('Api: Tasks 1/2, 50%')
})

test('a read that rejects leaves the tool result intact', { options: { watch: ['docs/plan.md'] }, plugins: [READER] }, async ($, on) => {
  host(on, {})
  expect(await edit($, '/w/docs/plan.md')).toEqual({ result: 'written' })
  expect(await atomOf($, 'flow')).toBe(null)
})

test('a file with no checkboxes makes no flow', { options: { watch: ['docs/plan.md'] }, plugins: [READER] }, async ($, on) => {
  host(on, { '/w/docs/plan.md': '# Notes\n\n- one\n- [] two\n' })
  await edit($, '/w/docs/plan.md')
  expect(await atomOf($, 'flow')).toBe(null)
})

test('a wildcard-free pattern is read at session start when it is there', { options: { watch: ['docs/plan.md', 'docs/*.md', '/w/gone.md'] } }, async ($, on) => {
  const h = host(on, { '/w/docs/plan.md': PLAN_MD })
  await start($, on)
  expect(h.probes).toEqual(['/w/docs/plan.md', '/w/gone.md'])
  expect(h.reads.filter(p => p.startsWith('/w/'))).toEqual(['/w/docs/plan.md'])
  expect(await band($)).toBe('Release prep: Tasks 1/3, 33%')
})

test('without a session directory relative patterns match nothing', { options: { watch: ['docs/plan.md', '/w/abs.md'] } }, async ($, on) => {
  const h = host(on, { '/w/docs/plan.md': PLAN_MD, '/w/abs.md': PLAN_MD }, null)
  await edit($, '/w/docs/plan.md')
  expect(h.reads).toEqual([])
  await edit($, '/w/abs.md')
  expect(await band($)).toBe('Release prep: Tasks 1/3, 33%')
})

test('an empty watch list registers nothing: no read, no probe, no flow', { plugins: [READER] }, async ($, on) => {
  const h = host(on, { '/w/docs/plan.md': PLAN_MD })
  await start($, on)
  expect(await edit($, '/w/docs/plan.md')).toEqual({ result: 'written' })
  expect(h.probes).toEqual([])
  expect(h.cwds).toEqual([])
  expect(h.reads.filter(p => p.startsWith('/w/'))).toEqual([])
  expect(await atomOf($, 'flow')).toBe(null)
})

test('status map: with no statusWords the shape is never tried', { options: { watch: ['status.yaml'] }, plugins: [READER] }, async ($, on) => {
  host(on, { '/w/status.yaml': STATUS_YAML })
  await edit($, '/w/status.yaml')
  expect(await atomOf($, 'flow')).toBe(null)
})

test('status map: configured words give done, skip and the phase, forward only', { options: { watch: ['status.yaml'], statusWords: WORDS }, plugins: [READER] }, async ($, on) => {
  const h = host(on, { '/w/status.yaml': STATUS_YAML })
  await edit($, '/w/status.yaml')
  expect(await band($)).toBe('Team board: Review 1/3, 33%')
  const f = await atomOf($, 'flow')
  expect((f?.tasks as { title: string }[]).map(t => t.title)).toEqual(['schema', 'api', 'search'])
  expect(f).toMatchObject({ doneTitles: ['schema'], source: '/w/status.yaml' })
  // api is back to an unmapped word: the phase does not go back.
  h.files['/w/status.yaml'] = STATUS_YAML.replace('api: building', 'api: waiting')
  await edit($, '/w/status.yaml')
  expect(await band($)).toBe('Team board: Review 1/3, 33%')
  h.files['/w/status.yaml'] = STATUS_YAML.replace('api: building', 'api: finished').replace('search: waiting', 'search: Finished')
  await edit($, '/w/status.yaml')
  expect(await band($)).toBe('Team board: Done, 100%')
})

test('status map: CRLF line endings keep a commented entry', { options: { watch: ['status.yaml'], statusWords: WORDS }, plugins: [READER] }, async ($, on) => {
  host(on, { '/w/status.yaml': STATUS_YAML.replaceAll('\n', '\r\n') })
  await edit($, '/w/status.yaml')
  expect(((await atomOf($, 'flow'))?.tasks as { title: string }[]).map(t => t.title)).toEqual(['schema', 'api', 'search'])
})

test('status map: checkboxes win when a file has both', { options: { watch: ['status.yaml'], statusWords: WORDS }, plugins: [READER] }, async ($, on) => {
  host(on, { '/w/status.yaml': `${STATUS_YAML}- [ ] one\n` })
  await edit($, '/w/status.yaml')
  expect((await atomOf($, 'flow'))?.total).toBe(1)
})
