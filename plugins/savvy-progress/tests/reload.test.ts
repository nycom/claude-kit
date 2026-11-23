import { expect, mock, test } from 'claude-code/testing'
import type { OnT } from './drawing'

// A reload inside a running session fires no session.start, so savvy's tools, command and language
// must come back with the first hook that runs after it, with the options of the new load.
const host = (on: OnT) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/k' })
  const reg: { name: string; inputSchema?: { properties: Record<string, unknown> } }[] = []
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.register', (_$, e) => (reg.push(e as never), { value: undefined }))
  on('command.register', (_$, e) => (reg.push(e as never), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return reg
}
const names = (reg: { name: string }[]) => reg.map(r => r.name)
const submit = ($: { prompt: { submit(e: never): Promise<unknown> } }) =>
  $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)

test('after a reload, the next prompt registers the tools and command with the new options', { options: { sessionNeed: 'tool' } }, async ($, on) => {
  const reg = host(on)
  await submit($)
  expect(names(reg)).toEqual(['progress', 'step', 'agents-info'])
  expect(Object.keys(reg[0].inputSchema!.properties)).toContain('blocked')
})

test('after a reload, a progress call registers before it runs, and only once', async ($, on) => {
  const reg = host(on)
  expect(await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', total: 1 } as never)).toEqual({ result: 'ok: Plan' } as never)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', done: 1 } as never)
  await submit($)
  expect(names(reg)).toEqual(['progress', 'step', 'agents-info'])
})

test('after a reload, a worker step call registers the tools', async ($, on) => {
  const reg = host(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__step', agentId: 'w1', done: 0, total: 3 } as never)
  expect(names(reg)).toEqual(['progress', 'step', 'agents-info'])
})

test('a started session registers once; later prompts and calls add nothing', async ($, on) => {
  const reg = host(on)
  await $.session.start({ cwd: '/w', source: 'startup' } as never)
  await submit($)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it' } as never)
  expect(names(reg)).toEqual(['progress', 'step', 'agents-info'])
})

test('each new session registers again', async ($, on) => {
  const reg = host(on)
  await $.session.start({ cwd: '/w', source: 'startup' } as never)
  await $.session.start({ cwd: '/w', source: 'clear' } as never)
  expect(names(reg)).toEqual(['progress', 'step', 'agents-info', 'progress', 'step', 'agents-info'])
})
