import { expect, test } from 'claude-code/testing'

import { PROPS, setup } from './drawing'
import type { $T, Node, OnT } from './drawing'

type Surface = 'terminal' | 'desktop'

const BLOCK = `STATUS  claude-setup  2026-10-30 18:05

REPOS
  claude-kit  [feat/status-panel]  dirty 0  ahead 1 behind 0

LEFT
  1. merge the m4 branch
  2. update the docs`

const stop = ($: $T, message?: string) =>
  $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [], ...(message === undefined ? {} : { last_assistant_message: message }) } as never)

// Every string the pane draws: Text, Svg alts and sources, on one line.
const drawn = async ($: $T, surface: Surface) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: PROPS })
  const nodes = (await ui.findAll({})) as unknown as Node[]
  await ui.unmount()
  return nodes.map(n => `${n.text ?? ''}${n.props?.alt ?? ''}${n.props?.source ?? ''}`).join('\n')
}

const setupStop = (on: OnT) => {
  setup(on)
  on('classic.Stop', () => ({}))
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a Stop with a STATUS block shows its header and the next gate`, async ($, on) => {
    setupStop(on)
    await stop($, `Here it is.\n${BLOCK}`)
    const out = await drawn($, surface)
    expect(out).toContain('STATUS claude-setup 2026-10-30 18:05')
    expect(out).toContain('next gate: merge the m4 branch')
    expect(out).not.toContain('update the docs')
  })

  test(`${surface}: LEFT says nothing left, so no gate line`, async ($, on) => {
    setupStop(on)
    await stop($, BLOCK.replace(/LEFT[\s\S]*/, 'LEFT\n  1. nothing left'))
    const out = await drawn($, surface)
    expect(out).toContain('STATUS claude-setup')
    expect(out).not.toContain('next gate')
  })

  test(`${surface}: "1. Nothing left." also means no gate line`, async ($, on) => {
    setupStop(on)
    await stop($, BLOCK.replace(/LEFT[\s\S]*/, 'LEFT\n  1. Nothing left.'))
    const out = await drawn($, surface)
    expect(out).toContain('STATUS claude-setup')
    expect(out).not.toContain('next gate')
  })

  test(`${surface}: an empty LEFT does not take a numbered item from a later section`, async ($, on) => {
    setupStop(on)
    await stop($, BLOCK.replace(/LEFT[\s\S]*/, 'LEFT\n\nNOTES\n  1. not a gate'))
    const out = await drawn($, surface)
    expect(out).toContain('STATUS claude-setup')
    expect(out).not.toContain('next gate')
    await stop($, BLOCK.replace(/LEFT[\s\S]*/, 'LEFT\nNOTES\n  1. not a gate'))
    expect(await drawn($, surface)).not.toContain('next gate')
  })

  test(`${surface}: a later Stop without a STATUS block keeps the last one`, async ($, on) => {
    setupStop(on)
    await stop($, BLOCK)
    await stop($, 'Done, pushed.')
    await stop($)
    const out = await drawn($, surface)
    expect(out).toContain('STATUS claude-setup')
    expect(out).toContain('next gate: merge the m4 branch')
  })

  test(`${surface}: a STATUS block with no LEFT section shows the header only`, async ($, on) => {
    setupStop(on)
    await stop($, BLOCK.replace(/\nLEFT[\s\S]*/, ''))
    const out = await drawn($, surface)
    expect(out).toContain('STATUS claude-setup')
    expect(out).not.toContain('next gate')
  })
}

test('desktop compact pane still shows the header and the next gate', async ($, on) => {
  setupStop(on)
  await stop($, BLOCK)
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: PROPS })
  await ui.post({ press: true }, { in: 'compact' })
  expect(await ui.find({ key: 'compact' })).toBeDefined()
  await ui.unmount()
  const out = await drawn($, 'desktop')
  expect(out).toContain('height="32"')
  expect(out).toContain('STATUS claude-setup 2026-10-30 18:05')
  expect(out).toContain('next gate: merge the m4 branch')
})

test('a very long STATUS line and gate are clipped', async ($, on) => {
  setupStop(on)
  await stop($, BLOCK.replace('2026-10-30 18:05', 'x'.repeat(500)).replace('merge the m4 branch', 'y'.repeat(500)))
  const out = await drawn($, 'terminal')
  expect(out).toContain('…')
  expect(out).not.toContain('x'.repeat(250))
  expect(out).not.toContain('y'.repeat(250))
})

test('no STATUS block ever: the pane draws no status lines', async ($, on) => {
  setupStop(on)
  await stop($, 'just an answer')
  for (const surface of ['terminal', 'desktop'] as const) {
    const out = await drawn($, surface)
    expect(out).not.toContain('STATUS')
    expect(out).not.toContain('next gate')
  }
})
