import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

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

  // No skins plugin loaded here: its theme reads as absent and colors.toml applies, with no error.
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

// skins publishes the chat's theme; while it names one, the pane and the band draw in it.
const SKINS: Plugin = {
  name: 'skins',
  register(on) {
    // `/skin <json>` sets the theme, as skins' /skin would.
    on('prompt.submit', async ($, e, next) => {
      if (e.text.startsWith('/skin ')) await $.state.set({ plugin: 'skins', key: 'theme' } as const, JSON.parse(e.text.slice(6)))
      return next(e)
    })
  },
}

test('theme: the skins theme wins over colors.toml, redraws when it changes, null falls back', { plugins: [SKINS] }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/k' })
  const file = '/home/k/.local/state/omarchy/current/theme/colors.toml'
  const TOKYO = 'accent = "#7aa2f7"\nselection = "#292e42"\nbackground = "#1a1b26"\nforeground = "#a9b1d6"\ndark_foreground = "#565f89"\nred = "#f7768e"\n'
  on('fs.stat', (_$, e) => {
    if (e.path === file) return { value: { kind: 'file', mtimeMs: 1 } as never }
    throw new Error('ENOENT')
  })
  on('fs.read', () => ({ value: TOKYO }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w1' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  const skin = (t: object | null) => $.prompt.submit({ text: `/skin ${JSON.stringify(t)}`, origin: { kind: 'user' }, wait: false } as never)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'fix tests', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'ship it', total: 2, done: 1 } as never)

  const pane = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  const band = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  const drawn = async (ui: typeof pane | typeof band) => {
    await clock.settle()
    return (await ui.findAll({ type: 'Svg' })).map(s => String((s as unknown as { props: { source: string } }).props.source)).join('')
  }
  expect(await drawn(pane)).toContain('.t{fill:#a9b1d6}')

  // skins' dim is the text tone savvy calls muted; its muted is a border tone, unused.
  const ROSE = { mode: 'dark', accent: '#c4a7e7', foreground: '#e0def4', dim: '#908caa', muted: '#6e6a86', red: '#eb6f92', selection: '#403d52', background: '#191724' }
  await skin(ROSE)
  for (const ui of [pane, band]) {
    const rose = await drawn(ui)
    expect(rose).toContain('<style>@media (prefers-color-scheme: dark){.t{fill:#e0def4}')
    expect(rose).not.toContain('#a9b1d6')
  }
  const rose = await drawn(pane)
  expect(rose).toContain('.s,.m,.tk{fill:#908caa}')
  expect(rose).toContain('.k{fill:#403d52}')
  expect(rose).toContain('.rt,.tile{fill:#191724}')
  expect(rose).toContain('.r{fill:#eb6f92}')
  expect(rose).not.toContain('#6e6a86')

  // A switch redraws the mounted pane; a light skin keeps the defaults, as a light colors.toml does.
  await skin({ ...ROSE, foreground: '#ffffff' })
  expect(await drawn(pane)).toContain('.t{fill:#ffffff}')
  await skin({ ...ROSE, mode: 'light' })
  const light = await drawn(pane)
  expect(light).not.toContain('<style>@media (prefers-color-scheme: dark){')
  expect(light).not.toContain('#a9b1d6')

  // The skin off: colors.toml again.
  await skin(null)
  expect(await drawn(pane)).toContain('.t{fill:#a9b1d6}')
  await pane.unmount()
  await band.unmount()
})
