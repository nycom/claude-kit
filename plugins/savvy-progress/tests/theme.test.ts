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
  expect(await drawn()).not.toContain('#283457')

  put('foreground = "#c0caf5"\naccent = "#7aa2f7"\nmuted = "#565f89"\nred = "#f7768e"\nselection = "#283457"\nbackground = "#1a1b26"\n')
  await clock.advance(2_000)
  const themed = await drawn()
  expect(themed).toContain('.t{fill:#c0caf5}')
  expect(themed).toContain('.k{fill:#283457}')
  expect(themed).toContain('.rt,.tile{fill:#1a1b26}')
  expect(themed).toContain('.r{fill:#f7768e}')
  expect(themed).toContain('.s,.m,.tk{fill:#565f89}')

  // A file with only the terminal colorN slots themes the pane too.
  put('color7 = "#d0d0d0"\ncolor4 = "#4488cc"\ncolor8 = "#777777"\ncolor1 = "#cc3344"\n')
  await clock.advance(2_000)
  const slots = await drawn()
  expect(slots).toContain('.t{fill:#d0d0d0}')
  expect(slots).toContain('.s,.m,.tk{fill:#777777}')
  expect(slots).toContain('.r{fill:#cc3344}')
  expect(slots).not.toContain('#283457')

  put(null)
  await clock.advance(2_000)
  expect(await drawn()).not.toContain('#d0d0d0')
  await ui.unmount()
})
