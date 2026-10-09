import { expect, mock, test } from 'claude-code/testing'

// The Agents pane takes its colours from Omarchy's colors.toml, follows a theme switch,
// and keeps its own colours when the file is missing or goes away.
test('theme: colors.toml recolours the pane; a missing file keeps the defaults', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/k' })
  let toml: string | null = null
  let mtimeMs = 0
  const file = '/home/k/.local/state/omarchy/current/theme/colors.toml'
  const put = (next: string | null) => ((toml = next), (mtimeMs += 1))
  on('fs.stat', (_$, e) => {
    if (toml !== null && e.path === file) return { value: { kind: 'file', mtimeMs } as never }
    throw new Error('ENOENT')
  })
  on('fs.read', (_$, e) => {
    if (toml !== null && e.path === file) return { value: toml }
    throw new Error('ENOENT')
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w1' }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'fix tests', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)

  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  const drawn = async () => {
    await clock.settle()
    return (await ui.findAll({ type: 'Svg' })).map(s => String((s as { props: { source: string } }).props.source)).join('')
  }

  // No file: the default tile and text colours, nothing themed.
  expect(await drawn()).toContain('.tile{fill:#f4f3f0}')
  expect(await drawn()).not.toContain('#13141c')

  // Omarchy's own keys (tokyo-night); with no file the poll runs once a minute, not every 2s.
  const TOKYO = 'mode = "dark"\naccent = "#7aa2f7"\nselection = "#292e42"\nmuted = "#414868"\nbackground = "#1a1b26"\ndark_background = "#13141c"\nforeground = "#a9b1d6"\ndark_foreground = "#565f89"\nred = "#f7768e"\n'
  put(TOKYO)
  await clock.advance(2_000)
  expect(await drawn()).not.toContain('#13141c')
  await clock.advance(58_000)
  const themed = await drawn()
  // Dark hosts only: the themed rules sit inside the dark media query.
  expect(themed).toContain('<style>@media (prefers-color-scheme: dark){.t{fill:#a9b1d6}')
  expect(themed).toContain('.k{fill:#292e42}')
  expect(themed).toContain('.rt,.tile{fill:#13141c}')
  expect(themed).toContain('.r{fill:#f7768e}')
  // Dim text is dark_foreground; muted is a border tone.
  expect(themed).toContain('.s,.m,.tk{fill:#565f89}')
  expect(themed).not.toContain('#414868')

  // Once found, a switch shows within 2s; a light theme keeps the defaults.
  put(TOKYO.replace('mode = "dark"', 'mode = "light"'))
  await clock.advance(2_000)
  expect(await drawn()).not.toContain('#13141c')
  put(TOKYO.replace('#a9b1d6', '#d0d0d0'))
  await clock.advance(2_000)
  expect(await drawn()).toContain('.t{fill:#d0d0d0}')

  put(null)
  await clock.advance(2_000)
  expect(await drawn()).not.toContain('#d0d0d0')
  await ui.unmount()
})
