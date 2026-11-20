import { expect, test } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const PROGRESS = 'mcp__savvy-progress__progress'
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }

// The flow is the main session's to report: a worker that calls `progress` could
// otherwise rename it, mark it finished or wipe the finished workers from the panel.
test('caller: a subagent cannot report the flow', async $ => {
  await $.tool.call({ tool: PROGRESS, title: 'Ship the thing', phase: 'delegate', total: 3, done: 1 } as never)

  const hijack = await $.tool.call({ tool: PROGRESS, agentId: 'a1', title: 'Hijacked', total: 9, done: 9, finished: true } as never)
  expect(hijack).toMatchObject({ result: 'ignored: only the main session reports the flow' })

  // Nothing moved: the band still draws the same flow.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band })
  // The fork draws the band in layers (base, top, crab): read them all.
  const row = (await ui.findAll({ type: 'Svg' })).map(n => String(n.props.source)).join('\n')
  expect(row).toContain('Ship the thing')
  expect(row).toContain('Tasks 1/3')
  expect(row).not.toContain('Hijacked')

  // The main session still can.
  expect(await $.tool.call({ tool: PROGRESS, done: 2 } as never)).toMatchObject({ result: 'ok: Tasks 2/3' })
})

test('caller: a subagent cannot start a flow either', async $ => {
  const started = await $.tool.call({ tool: PROGRESS, agentId: 'a1', title: 'Hijacked', phase: 'delegate', total: 2 } as never)
  expect(started).toMatchObject({ result: 'ignored: only the main session reports the flow' })
  // The main session's first report starts at its own counts.
  expect(await $.tool.call({ tool: PROGRESS, title: 'Real flow', phase: 'delegate', total: 4 } as never)).toMatchObject({ result: 'ok: Tasks 0/4' })
})

// Hydra's coordinator reports from the main session with phase "delegate": the guard must not silence it.
test('caller: a main-session progress call with phase "delegate" still sets the flow', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never) // a plan auto-opens the pane
  const r = await $.tool.call({ tool: PROGRESS, title: 'hydra run', phase: 'delegate', total: 2, tasks: [{ title: 'ws-a', tier: 'careful' }, { title: 'ws-b', tier: 'medium' }] } as never)
  expect(r).toMatchObject({ result: 'ok: Tasks 0/2' })
})
