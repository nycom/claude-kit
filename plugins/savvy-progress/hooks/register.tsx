import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, BackgroundTask, Flow, Palette, Panel, Phase, PlannedTask } from '../types'

const flow = atom({ plugin: 'savvy-progress', key: 'flow' } as const, null)
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [])
const panel = atom({ plugin: 'savvy-progress', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  autoOpenedFor: '',
})
const now = atom({ plugin: 'savvy-progress', key: 'now' } as const, 0)
const theme = atom({ plugin: 'savvy-progress', key: 'theme' } as const, null)
const background = atom({ plugin: 'savvy-progress', key: 'background' } as const, [])

const TOOL = 'mcp__savvy-progress__progress'
const STEP_TOOL = 'mcp__savvy-progress__step'
const PANE = 'savvy-agents'
const PHASES: readonly Phase[] = ['plan', 'design', 'delegate', 'review', 'close']
const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'
const THEME_FILE = '.local/state/omarchy/current/theme/colors.toml'
const THEME_POLL_MS = 2000
// No theme file yet: look again once a minute, so one created later is still picked up.
const THEME_IDLE_MS = 60_000

type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: Phase
  finished?: boolean
  tasks?: { title?: string; tier?: string; after?: number[] }[]
}

// The Omarchy palette, when its file exists; render handlers copy the atom here and
// the drawings read it, so a missing file (null) keeps every default colour.
let pal: Palette | null = null
let themePoll: { cancel(): void } | null = null
let themeEvery = 0
let clockTick: { cancel(): void } | null = null
let tickMs = 0
let themePath = ''
const accentOf = (): string => pal?.accent ?? ACCENT

// Appended after the default styles (same specificity, later wins), in dark only: the
// palette is a dark one and cards draw on the host's page, so a light host keeps the defaults.
// Tile labels turn to the text colour: muted on the selection tile is too faint to read.
const themeCss = (): string =>
  pal
    ? `<style>@media (prefers-color-scheme: dark){${[
        pal.foreground && `.t{fill:${pal.foreground}}`,
        pal.muted && `.s,.m,.tk{fill:${pal.muted}}`,
        pal.foreground && `.tl{fill:${pal.foreground};fill-opacity:.7}`,
        pal.selection && `.k{fill:${pal.selection}}.ln{stroke:${pal.selection}}`,
        pal.red && `.r{fill:${pal.red}}`,
        // Tiles take the theme's page colour: a quiet card, as the defaults draw it.
        pal.background && `.rt,.tile{fill:${pal.background}}`,
      ].join('')}}</style>`
    : ''

// Omarchy's keys, first found wins: dim text is `dark_foreground` (`muted` is a border
// tone, too faint for text), tiles the dark background over the plain one.
const THEME_FALLBACK: Record<keyof Palette, string[]> = {
  foreground: ['foreground'],
  accent: ['accent'],
  muted: ['dark_foreground', 'muted'],
  red: ['red'],
  selection: ['selection'],
  background: ['dark_background', 'background'],
}
let themeMtime = 0

// Re-arms the poll only when its cadence changes.
const pollTheme = ($: EngineInterface, ms: number): void => {
  if (ms === themeEvery) return
  themeEvery = ms
  themePoll?.cancel()
  themePoll = $.clock.every(ms, () => void loadTheme($))
}

async function loadTheme($: EngineInterface): Promise<void> {
  let next: Palette | null = null
  try {
    // A stat per poll; the file is read only when it changed.
    const stat = await $.fs.stat(themePath)
    if (stat.kind !== 'file') throw new Error('no theme file')
    pollTheme($, THEME_POLL_MS)
    if (stat.mtimeMs === themeMtime) return
    themeMtime = stat.mtimeMs
    const toml = String(await $.fs.read(themePath))
    const get = (k: string) => toml.match(new RegExp(`^${k}\\s*=\\s*"(#[0-9a-fA-F]{6})"`, 'm'))?.[1]
    const found = Object.fromEntries(
      Object.entries(THEME_FALLBACK).flatMap(([k, keys]) => {
        const hex = keys.map(get).find(Boolean)
        return hex ? [[k, hex]] : []
      }),
    )
    // A light theme keeps the defaults: the palette is drawn for dark hosts only.
    if (Object.keys(found).length && !/^mode\s*=\s*"light"/m.test(toml)) next = found
  } catch {
    // No theme file: the defaults stay.
    themeMtime = 0
    pollTheme($, THEME_IDLE_MS)
  }
  // An atom update redraws every reader, so only write a palette that changed.
  if (JSON.stringify(next) !== JSON.stringify(await read($, theme))) await update($, theme, () => next)
}

// ---------------------------------------------------------------------------
// Language: the `language` option, else Claude Code's `language` setting, else the
// process locale; English when nothing says Russian.

type Lang = 'en' | 'ru'

const STRINGS = {
  en: {
    pane: 'Agents',
    cost: 'Cost',
    tokens: 'Tokens',
    time: 'Time',
    collapse: 'Collapse',
    expand: 'Expand',
    running: 'Running',
    finished: 'Ended',
    planned: 'Planned',
    empty: 'No subagents yet.',
    round: 'round',
    failed: 'error',
    after: 'after',
    tokensWord: 'tokens',
    agentsCount: 'agents',
    isRunning: 'running',
    isFinished: 'finished',
    isPlanned: 'planned',
    opened: 'Agents panel opened.',
    closed: 'Agents panel closed.',
    done: 'Done',
    plan: 'Plan',
    design: 'Design',
    tasks: 'Tasks',
    review: 'Review',
    busy: 'running',
    isFailed: 'failed',
    needsInput: 'NEEDS INPUT',
    failedFlag: 'FAILED',
    agent: 'agent',
    toastInput: 'needs input',
    toastFailed: (n: number) => `failed ${n} times`,
    chip: (n: number) => `⚠ ${n} ${n === 1 ? 'needs' : 'need'} attention`,
    background: 'Background',
    stop: 'Stop',
    nextIn: (t: string) => `next in ${t}`,
    due: 'due',
    stopFailed: (what: string, err: string) => `could not stop ${clip(what, 60)}: ${err}`,
    kinds: { shell: 'shell', monitor: 'monitor', cron: 'scheduled', wakeup: 'loop wakeup' },
  },
  ru: {
    pane: 'Агенты',
    cost: 'Стоимость',
    tokens: 'Токены',
    time: 'Время',
    collapse: 'Свернуть',
    expand: 'Развернуть',
    running: 'Работают',
    finished: 'Закончили',
    planned: 'Запланированы',
    empty: 'Субагентов пока нет.',
    round: 'раунд',
    failed: 'ошибка',
    after: 'после',
    tokensWord: 'токенов',
    agentsCount: 'агентов',
    isRunning: 'работает',
    isFinished: 'завершён',
    isPlanned: 'запланирована',
    opened: 'Панель агентов открыта.',
    closed: 'Панель агентов закрыта.',
    done: 'Готово',
    plan: 'План',
    design: 'Дизайн',
    tasks: 'Задачи',
    review: 'Ревью',
    busy: 'в работе',
    isFailed: 'с ошибкой',
    needsInput: 'НУЖЕН ОТВЕТ',
    failedFlag: 'НЕУДАЧ',
    agent: 'агент',
    toastInput: 'нужен ответ',
    toastFailed: (n: number) => `неудач: ${n}`,
    chip: (n: number) => `⚠ ${n} ${n === 1 ? 'требует' : 'требуют'} внимания`,
    background: 'Фоновые',
    stop: 'Стоп',
    nextIn: (t: string) => `через ${t}`,
    due: 'пора',
    stopFailed: (what: string, err: string) => `не удалось остановить ${clip(what, 60)}: ${err}`,
    kinds: { shell: 'команда', monitor: 'монитор', cron: 'по расписанию', wakeup: 'пробуждение цикла' },
  },
} as const

// Module scope is fine here: session.start sets it again on every (re)load.
let lang: Lang = 'en'
const tr = () => STRINGS[lang]

const isRussian = (v: unknown): boolean => typeof v === 'string' && /^(ru|russian|рус)/i.test(v.trim())

async function detectLang($: EngineInterface, option: unknown): Promise<Lang> {
  if (option === 'en' || option === 'ru') return option
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    if (typeof settings.language === 'string' && settings.language.trim()) return isRussian(settings.language) ? 'ru' : 'en'
  } catch {
    // No settings: fall through to the locale.
  }
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  return isRussian(locale) ? 'ru' : 'en'
}

const blank = (): Flow => ({
  title: 'savvy-flow',
  total: 0,
  done: 0,
  running: 0,
  phase: 'plan',
  isFinished: false,
  tasks: [],
})

const isNewFlow = (prev: Flow | null, input: ProgressInput): boolean =>
  !prev || prev.isFinished || (input.title !== undefined && input.title.trim() !== prev.title)

const cleanTasks = (tasks: ProgressInput['tasks']): PlannedTask[] | undefined =>
  tasks
    ?.filter(t => t.title?.trim())
    .map(t => ({
      title: (t.title ?? '').trim(),
      tier: (t.tier ?? '').replace(/^savvy-/, '').trim().toLowerCase(),
      after: (t.after ?? []).filter(n => Number.isInteger(n) && n > 0),
    }))

const merge = (prev: Flow | null, input: ProgressInput): Flow => {
  // A new title means a new flow: never carry counters over from an earlier one.
  const base = isNewFlow(prev, input) || !prev ? blank() : { ...blank(), ...prev }
  const tasks = cleanTasks(input.tasks) ?? base.tasks
  const total = Math.max(0, Math.round(input.total ?? (input.tasks ? tasks.length : base.total)))
  const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? base.done)))
  const phase = input.phase && PHASES.includes(input.phase) ? input.phase : base.phase
  return {
    ...base,
    title: input.title?.trim() || base.title,
    total,
    done,
    phase: input.finished ? 'close' : phase,
    isFinished: input.finished === true,
    tasks,
  }
}

const label = (f: Flow): string => {
  const s = tr()
  if (f.isFinished) return s.done
  if (f.phase === 'plan') return s.plan
  if (f.phase === 'design') return s.design
  const count = f.total ? `${f.done}/${f.total}` : `${f.running} ${s.busy}`
  return `${f.phase === 'review' ? s.review : s.tasks} ${count}`
}

const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0)

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// The whole row is one SVG: the desktop wraps sibling elements onto new lines,
// so title, bar, percent and the crab live in one drawing; only the count and
// the dismiss are Buttons beside it. The host gives a Button a margin-block of
// (band line − control)/2 and lays it from the row's top, so its centre is band line / 2:
// the images are the band line's height (23, as skins' band) and draw on H / 2.
const H = 23
const BAR_H = 16
const CRAB_W = 26
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

// Rough advance of system UI text, in em; good enough to size the title's slot.
const charEm = (ch: string): number =>
  /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZА-ЯЁmwшщжюМШЩЖЮ@%]/.test(ch) ? 0.72 : 0.56

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const rowSvg = (f: Flow, W: number, isWorking: boolean): string => {
  // The title takes what it needs, up to 40% of the row; the bar takes the rest.
  const title = fitText(f.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const color = f.isFinished ? DONE : accentOf()
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(f))
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total) : 0
  const dots: string[] = []

  // Dithered fill: sparse at the start, dense toward the head.
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // Handed to workers, not yet accepted: a faint second layer.
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect class="t${Math.floor(noise(r + 5, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }

  const ticks: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  const text = label(f)
  const bandPillW = Math.round(18 + text.length * 6.6)
  const pillX = Math.max(0, Math.min(BAR_W - bandPillW, fillW - bandPillW))
  const percent = `${Math.round(ratio(f) * 100)}%`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#6b6b68}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
</style>${themeCss()}<style>
/* Pixels twinkle in four out-of-phase groups; a finished bar settles to a slow glow. */
.t0,.t1,.t2,.t3{animation:tw ${f.isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${f.isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${f.isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${f.isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join('')}</g>
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${bandPillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + bandPillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="${f.isFinished ? '#0f2a1c' : '#1f1e1d'}">${xml(text)}</text>
</g>
<text class="m" x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${CRAB_CSS}${crab(W - CRAB_W + 1, crabTop('other', 0.8), 'other', false, isWorking, 0.8)}
</svg>`
}

const barText = (f: Flow, width: number): string => {
  const filled = Math.round(width * ratio(f))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// ---------------------------------------------------------------------------
// Agents panel: every subagent of the session, plus the tasks the flow planned.

const TIER_COLOR: Record<string, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
  other: '#888780',
}

// The same hues darkened (light theme) and lightened (dark) for 11px text: >= 4.5:1
// on #faf9f5 and #262624. The fills above stay for crabs and bars.
const TIER_TEXT: Record<string, [string, string]> = {
  fable: ['#6a62cc', '#9d97ea'],
  heavy: ['#b44a22', '#e2754f'],
  careful: ['#94600f', '#d18f2c'],
  medium: ['#2a6fb8', '#5ea2e6'],
  light: ['#177f5e', '#3fb88d'],
  other: ['#6e6d68', '#a3a29c'],
}
const tierCss = (i: 0 | 1): string => Object.entries(TIER_TEXT).map(([k, c]) => `.tc-${k}{fill:${c[i]}}`).join('')

// Attention flag red: text >= 4.5:1 on both host backgrounds, and pill text on the fill.
const RED = '#b3261e'

// What each savvy tier runs on, for planned tasks that have no run yet.
const colorOf = (tier: string): string => TIER_COLOR[tier] ?? '#888780'

const TIER_MODEL: Record<string, string> = {
  fable: 'Fable · high',
  heavy: 'Opus · xhigh',
  careful: 'Opus · high',
  medium: 'Sonnet',
  light: 'Opus · low',
}

// USD per million tokens: input, output, cache read, cache write (5-minute TTL).
// The engine reports tokens, not money, so the panel's cost is an estimate.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const priceOf = (model: string): [number, number, number, number] =>
  PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]

const costOf = (model: string, u: Usage): number => {
  const [i, o, r, w] = priceOf(model)
  return (
    ((u.input_tokens || 0) * i +
      (u.output_tokens || 0) * o +
      (u.cache_read_input_tokens || 0) * r +
      (u.cache_creation_input_tokens || 0) * w) /
    1e6
  )
}

const windowOf = (model: string): number => (/haiku/i.test(model) ? 200_000 : 1_000_000)

// `savvy-careful`, or `savvy-flow:savvy-careful` when the agents ship in a plugin.
const tierOf = (type: string): string => {
  const bare = type.replace(/^[^:]*:/, '')
  const t = bare.replace(/^savvy-/, '').toLowerCase()
  return t in TIER_COLOR && bare.startsWith('savvy-') ? t : 'other'
}

const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const elapsed = (a: { startedAt: number; endedAt?: number }, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

type Planned = PlannedTask & { n: number }

const plannedOf = (f: Flow | null, list: AgentRun[]): Planned[] => {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => norm(a.description)))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !started.has(norm(t.title)))
}

const totals = (list: AgentRun[], at: number) => {
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  const tokens = list.reduce((s, a) => s + a.tokens, 0)
  const start = Math.min(...list.map(a => a.startedAt))
  const end = Math.max(...list.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  return { cost, tokens, time: list.length ? end - start : 0 }
}

// --- desktop drawings: each row is one SVG, as the band above the prompt is.

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#73736f}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}.r{fill:${RED}}.rt{fill:#ffffff}${tierCss(0)}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#9d9d98}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}.r{fill:#ff8a80}.rt{fill:#1f1e1d}${tierCss(1)}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

// Pixel Clawd from DockCrab (Clawdy): a 24×18 crab on a 30×28 grid, one costume per tier.
// The body keeps the brand clay; the tier's color lives in the costume's accent.
const CLAY = '#D97757'
const INK = '#1F1E1D'

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor: no redraws. Periods divide one second, so the
// once-a-second redraw of a running row restarts them in phase. Every crab walks;
// each costume adds its prop's own motion on top.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
.c-implement.run .c1{animation:blink .5s steps(1) infinite}.c-implement.run .c2{animation:blink .5s steps(1) infinite -.25s}
.c-review.run .chk{animation:blink 1s steps(1) infinite}.c-review.run .chk2{animation:blink 1s steps(1) infinite -.5s}
.c-design.run .it{transform-origin:0 100%;animation:paint .5s ease-in-out infinite}
@keyframes paint{50%{transform:rotate(-20deg)}}
.c-test.run .bub{animation:blink .5s steps(1) infinite}.c-test.run .bub2{animation:blink .5s steps(1) infinite -.25s}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Fable: astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  fable: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Heavy: detective with a deerstalker; the magnifier sweeps and glints.
  heavy: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Careful: engineer in a hard hat; the wrench turns a bolt.
  careful: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Medium: chef, the toque traced from DockCrab's Sprites.chefHat; tosses the omelette.
  medium: (f, t) => {
    crabBody(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Light: racer in a helmet; runs at double pace, the checkered flag flutters.
  light: (f, t) => {
    crabBody(f, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // Explore: pirate scouting the code; the cutlass fences.
  explore: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  // Implementer: developer in a beanie at a laptop; the code lines type.
  implement: (f, t) => {
    crabBody(f)
    stamp(f, 7, 4, ['......pp........', '....kkkkkkkk....', '..kkkkkkkkkkkk..', '.kkkkkkkkkkkkkk.', 'rrrrrrrrrrrrrrrr', 'rrrrrrrrrrrrrrrr'], { p: t, k: '#3E4A61', r: '#56637E' })
    stamp(f, 22, 12, ['kkkkkkkk', 'kssssssk', 'kssssssk', 'kssssssk', 'kkkkkkkk', 'gggggggg'], { k: '#3A3A3C', s: '#1F2A36', g: '#8E929A' })
    f(24, 13, 3, 1, t, 'c1'); f(25, 14, 3, 1, '#E6E8EE', 'c2'); f(24, 15, 2, 1, '#7DCFFF', 'c1')
  },
  // Reviewer: round glasses and a clipboard; the ticks go down the list.
  review: (f, t) => {
    crabBody(f, -4)
    stamp(f, 8, 11, ['kkkk......kkkk', 'kllkkkkkkkkllk', 'kllk......kllk', 'kkkk......kkkk'], { k: '#2B2B2E', l: 'rgba(255,255,255,.35)' })
    stamp(f, 22, 7, ['..mmm..', 'bbbbbbb', 'bwwwwwb', 'bwwwwwb', 'bwwwwwb', 'bwwwwwb', 'bwwwwwb', 'bbbbbbb'], { m: '#8E929A', b: '#7A4A26', w: '#F4F3EE' })
    f(24, 10, 1, 1, t, 'chk'); f(25, 11, 1, 1, t, 'chk'); f(26, 10, 1, 1, t, 'chk'); f(27, 9, 1, 1, t, 'chk')
    f(24, 13, 1, 1, t, 'chk2'); f(25, 14, 1, 1, t, 'chk2'); f(26, 13, 1, 1, t, 'chk2'); f(27, 12, 1, 1, t, 'chk2')
  },
  // Designer: beret and a palette; the brush paints.
  design: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 5, ['..........k.......', '...bbbbbbbbbb.....', '.bbbbbbbbbbbbbbb..', 'bbbbbbbbbbbbbbbbbb', '.dddddddddddddddd.'], { k: '#2B2B2E', b: '#C8423B', d: '#9E2F2A' })
    stamp(f, 0, 13, ['.www.', 'wrwyw', 'wwbww', '.ww..'], { w: '#D9B38C', r: '#C8423B', y: '#F5C542', b: '#378ADD' })
    f(25, 3, 1, 7, '#7A4A26', 'it'); f(25, 2, 1, 1, '#C9CCD2', 'it'); f(24, 0, 3, 2, t, 'it')
  },
  // Tester: lab goggles up and a test tube; the bubbles rise.
  test: (f, t) => {
    crabBody(f, -4)
    f(7, 9, 16, 1, '#3A3A3C')
    stamp(f, 8, 6, ['kkkk......kkkk', 'kllk......kllk', 'kkkkkkkkkkkkkk'], { k: '#3A3A3C', l: 'rgba(125,207,255,.75)' })
    stamp(f, 24, 2, ['ggggg', '.g.g.', '.g.g.', '.glg.', '.glg.', '.glg.', '..g..'], { g: '#C9CCD2', l: t })
    f(26, 3, 1, 1, '#E6E8EE', 'bub'); f(26, 1, 1, 1, '#E6E8EE', 'bub2')
  },
  other: f => crabBody(f),
}

// Role costumes, from the type's name first (impeccable-finish-reviewer), then the task's words.
// First match wins, in this order: "fix tests" is a tester, "review the design" a reviewer.
// Whole words with a common ending; a hyphen ends a match too, so `claude-code-guide` is no coder.
const roleWords = (stems: string): RegExp => new RegExp(`\\b(?:${stems})(?:s|es|e?d|ing|e?rs?)?(?![\\w-])`, 'i')
const ROLES: [costume: string, words: RegExp][] = [
  ['review', roleWords('review|audit|grill|verif(?:y|i|ication)|critiqu(?:e|ing)|inspect')],
  ['test', roleWords('test|qa|e2e|repro|reproduc(?:e|ing)')],
  ['design', roleWords('design|ui|ux|mockup|impeccable|visual|styl(?:e|ing)')],
  ['implement', roleWords('implement|build|fix|add|refactor|cod(?:e|ing)|develop|migrat(?:e|ing)|wir(?:e|ing)')],
]
const roleOf = (text: string): string | undefined => ROLES.find(([, words]) => words.test(text))?.[0]

// The pirate is Explore's alone; a role beats the tier's costume, the card keeping the tier's colour.
const costumeOf = (a: { type: string; description?: string }): string =>
  a.type === 'Explore' ? 'explore' : (roleOf(a.type.replace(/^[^:]*:/, '')) ?? roleOf(a.description ?? '') ?? tierOf(a.type))

const CRAB_SCALE = 1.1

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own.
const crab = (x: number, y: number, costume: string, dim = false, isWalking = false, scale = CRAB_SCALE, tint = colorOf(costume)): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  const draw = COSTUMES[costume] ?? ((g: Fill) => crabBody(g))
  draw(f, tint)
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

// The y that centres a costume's drawn rows, at `scale`, on the row's centre line.
const crabTop = (costume: string, scale: number): number => {
  let top = Infinity
  let bottom = -Infinity
  ;(COSTUMES[costume] ?? ((g: Fill) => crabBody(g)))((_x, y, _w, h) => ((top = Math.min(top, y)), (bottom = Math.max(bottom, y + h))), '')
  return H / 2 - (scale * (top + bottom)) / 2
}

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${themeCss()}${CRAB_CSS}${body}</svg>`

// The pane's own title already says "Agents": the header names the flow, if any.
const headerSvg = (W: number, title: string, t: ReturnType<typeof totals>): string => {
  const s = tr()
  const gap = 6
  const tw = (W - gap * 2) / 3
  const top = title ? 28 : 0
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s tl" x="${i * (tw + gap) + 9}" y="${top + 16}" font-family="${FONT}" font-size="11">${k}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="${top + 33}" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${v}</text>`
  return svg(
    W,
    headerHeight(title),
    `${title ? `<text class="t" x="0" y="15" font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}
${tile(0, s.cost, '≈' + fmtCost(t.cost))}${tile(1, s.tokens, fmtTokens(t.tokens))}${tile(2, s.time, fmtTime(t.time))}`,
  )
}

const headerHeight = (title: string): number => (title ? 72 : 44)

// The task's own progress when the worker reports steps; a finished run is full.
const progressOf = (a: AgentRun): number | null => {
  if (a.status === 'done') return 1
  if (a.stepTotal) return Math.min(1, (a.stepDone ?? 0) / a.stepTotal)
  return null
}

// A running worker waiting on a question, or one whose attempts keep failing; an ended one is history.
const needsAttention = (a: AgentRun): boolean => a.status === 'running' && (!!a.blocked || (a.failedAttempts ?? 0) >= 3)

// An ended run's failed streak, kept in its meta once the flag is gone.
const failedHistory = (a: AgentRun): string =>
  a.status !== 'running' && (a.failedAttempts ?? 0) >= 3 ? `${tr().failedFlag.toLowerCase()} ×${a.failedAttempts}` : ''

const flagOf = (a: AgentRun): string => (a.blocked ? tr().needsInput : `${tr().failedFlag} ×${a.failedAttempts ?? 0}`)

// The red label: static, no animation.
const pillW = (text: string): number => Math.round(textWidth(text, 10) + 12)
const pill = (x: number, y: number, text: string): string =>
  `<rect class="r" x="${x}" y="${y}" width="${pillW(text)}" height="15" rx="7.5"/><text class="rt" x="${x + pillW(text) / 2}" y="${y + 11}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700">${xml(text)}</text>`

const agentHeight = (a: AgentRun): number => (a.blocked ? 82 : 66)

const ctxOf = (a: AgentRun): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

const agentSvg = (W: number, a: AgentRun, at: number): string => {
  const s = tr()
  const tier = tierOf(a.type)
  const color = colorOf(tier)
  const ctx = ctxOf(a)
  const textW = W - 42 - 22
  const meta = [a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model)]
  if (a.round > 1) meta.push(`${s.round} ${a.round}`)
  if (a.status === 'failed') meta.push(s.failed)
  if (failedHistory(a)) meta.push(failedHistory(a))
  const barW = textW
  const progress = progressOf(a)
  const stats = `ctx ${ctx}% · ${fmtTokens(a.contextTokens)}  ≈${fmtCost(a.costUsd)}  ${fmtTime(elapsed(a, at))}`
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : ''
  const stepsW = Math.max(0, barW - textWidth(stats, 11) - 12)
  // Without reported steps the bar falls back to the context, drawn grey.
  const fillW = Math.round(barW * (progress ?? ctx / 100))
  const flag = needsAttention(a) ? flagOf(a) : ''
  const title = fitText(a.description || a.type, 13, textW - (flag ? pillW(flag) + 8 : 0))
  const h = agentHeight(a)
  return svg(
    W,
    h,
    `${crab(0, 14, costumeOf(a), false, a.status === 'running', CRAB_SCALE, color)}
<text class="t" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(title)}</text>${flag ? pill(Math.round(42 + textWidth(title, 13) + 8), 6, flag) : ''}
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan class="tc-${tier}">${xml(tier === 'other' ? a.type : tier)}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" x="42" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${42 + barW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${stats}</text>
<rect class="k" x="42" y="55" width="${barW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="42" y="55" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>
${statusMark(W - 8, 16, a.status, color)}
${a.blocked ? `<text class="r" x="42" y="75" font-family="${FONT}" font-size="11">${xml(fitText(`↳ ${a.blocked}`, 11, textW))}</text>` : ''}
<line class="ln" x1="0" y1="${h - 0.5}" x2="${W}" y2="${h - 0.5}"/>`,
  )
}

// Compact view: one line per flagged agent, so the label is never hidden.
const flagSvg = (W: number, a: AgentRun): string => {
  const flag = flagOf(a)
  const text = `${a.description || a.type}${a.blocked ? ` — ${a.blocked}` : ''}`
  return svg(W, 20, `${pill(0, 2, flag)}<text class="t" x="${pillW(flag) + 8}" y="14" font-family="${FONT}" font-size="12">${xml(fitText(text, 12, W - pillW(flag) - 8))}</text>`)
}

const agentAlt = (a: AgentRun): string => {
  const s = tr()
  const status = a.status === 'running' ? s.isRunning : a.status === 'failed' ? s.isFailed : s.isFinished
  const flag = needsAttention(a) ? `, ${flagOf(a)}${a.blocked ? `: ${a.blocked}` : ''}` : ''
  return `${a.description}: ${modelName(a.model)}, ${status}${flag}`
}

const plannedSvg = (W: number, p: Planned): string => {
  const tier = p.tier in TIER_COLOR ? p.tier : 'other'
  const color = colorOf(tier)
  const textW = W - 42 - 22
  const meta = [TIER_MODEL[tier] ?? '']
  if (p.after.length) meta.push(`${tr().after} ${p.after.join(', ')}`)
  return svg(
    W,
    46,
    `${crab(0, 6, tier, true)}
<text class="s" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan class="tc-${tier}">${xml(tier)}</tspan><tspan class="m">  ${xml(meta.filter(Boolean).join('  ·  '))}</tspan></text>
${statusMark(W - 8, 16, 'planned', color)}
<line class="ln" x1="0" y1="45.5" x2="${W}" y2="45.5"/>`,
  )
}

const compactSvg = (W: number, list: AgentRun[], planned: Planned[], t: ReturnType<typeof totals>): string => {
  const icons = [
    ...list.filter(a => a.status === 'running').map(a => ({ k: costumeOf(a), c: colorOf(tierOf(a.type)), s: 'running', dim: false })),
    ...list.filter(a => a.status !== 'running').map(a => ({ k: costumeOf(a), c: colorOf(tierOf(a.type)), s: a.status, dim: false })),
    ...planned.map(p => ({ k: p.tier in TIER_COLOR ? p.tier : 'other', c: colorOf(p.tier), s: 'planned', dim: true })),
  ]
  const fit = Math.max(1, Math.floor((W - 150) / 36))
  const shown = icons.slice(0, fit)
  const more = icons.length - shown.length
  const body = shown
    .map(
      (ic, i) =>
        crab(i * 36, 0, ic.k, ic.dim, ic.s === 'running', CRAB_SCALE, ic.c) +
        (ic.s === 'running' ? `<circle class="live" cx="${i * 36 + 32}" cy="4" r="3" fill="${ic.c}"/>` : ic.s === 'failed' ? statusMark(i * 36 + 30, 5, 'failed', '') : ''),
    )
    .join('')
  const x = shown.length * 36 + (more ? 4 : 0)
  return svg(
    W,
    32,
    `${body}${more ? `<text class="s" x="${x}" y="21" font-family="${FONT}" font-size="12">+${more}</text>` : ''}
<text class="s" x="${W}" y="21" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} · ${fmtTime(t.time)}</text>`,
  )
}

// --- background work: shells and monitors that run, crons and wakeups that wait.

const isActive = (t: BackgroundTask): boolean => t.status === 'running' || t.status === 'scheduled'

const fmtIn = (ms: number): string => {
  const m = Math.max(0, Math.ceil(ms / 60_000))
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`
}

const BG_ICON: Record<BackgroundTask['kind'], string> = { shell: '$', monitor: '◉', cron: '⏲', wakeup: '↻' }

const bgTitle = (t: BackgroundTask): string => t.text || tr().kinds[t.kind]

// What runs shows its time so far, what waits its countdown, what ended its duration.
const bgMeta = (t: BackgroundTask, at: number): string => {
  const s = tr()
  if (t.status !== 'scheduled') return `${s.kinds[t.kind]} · ${fmtTime(elapsed(t, at))}`
  return `${s.kinds[t.kind]} · ${t.nextAt ? (t.nextAt > at ? s.nextIn(fmtIn(t.nextAt - at)) : s.due) : (t.schedule ?? '')}`
}

const bgMark = (t: BackgroundTask): string => (t.status === 'scheduled' ? 'planned' : t.status)

const BG_H = 40

const bgSvg = (W: number, t: BackgroundTask, at: number): string => {
  const failed = t.status === 'failed' ? tr().isFailed : ''
  const title = fitText(bgTitle(t), 13, W - 42 - 22 - (failed ? pillW(failed) + 8 : 0))
  return svg(
    W,
    BG_H,
    `<text class="s" x="14" y="25" text-anchor="middle" font-family="${FONT}" font-size="16">${BG_ICON[t.kind]}</text>
<text class="t" x="42" y="16" font-family="${FONT}" font-size="13" font-weight="600">${xml(title)}</text>${failed ? pill(Math.round(42 + textWidth(title, 13) + 8), 4, failed) : ''}
<text class="s" x="42" y="32" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(bgMeta(t, at))}</text>
${statusMark(W - 8, 16, bgMark(t), accentOf())}
<line class="ln" x1="0" y1="${BG_H - 0.5}" x2="${W}" y2="${BG_H - 0.5}"/>`,
  )
}

// The clock ticks every second while an agent or a background task runs, every minute
// while only scheduled rows wait (their countdowns are in minutes), not at all otherwise.
// One timer: a change of pace cancels it before arming the next. The calls run one at a
// time, so a call that read the state before a change cannot undo the one made after it.
let reticking: Promise<void> = Promise.resolve()
function retick($: EngineInterface): Promise<void> {
  const run = reticking.then(() => repace($))
  reticking = run.catch(() => undefined)
  return run
}

async function repace($: EngineInterface): Promise<void> {
  const isRunning = (await read($, agents)).some(a => a.status === 'running')
  const bg = await read($, background)
  const ms = isRunning || bg.some(t => t.status === 'running') ? 1000 : bg.some(isActive) ? 60_000 : 0
  if (ms === tickMs) return
  clockTick?.cancel()
  tickMs = ms
  clockTick = ms
    ? $.clock.every(ms, () => {
        void (async () => {
          const at = await $.clock.now()
          await update($, now, () => at)
          await retick($)
        })()
      })
    : null
}

// Writes the list only when it changed: every write redraws the pane.
async function setBackground($: EngineInterface, change: (list: BackgroundTask[]) => BackgroundTask[]): Promise<void> {
  const prev = await read($, background)
  if (JSON.stringify(change(prev)) !== JSON.stringify(prev)) await update($, background, list => change(list).slice(-100))
  await retick($)
}

// Ends the active tasks that match, failed when the word says so (`failed`, an error).
async function finishTask($: EngineInterface, isIt: (t: BackgroundTask) => boolean, status: string): Promise<void> {
  const at = await $.clock.now()
  const ended = /fail|error/i.test(status) ? ('failed' as const) : ('done' as const)
  // A failed notification can arrive after the Stop reconcile already ended the task as done.
  const isOpen = (t: BackgroundTask) => isActive(t) || (ended === 'failed' && t.status === 'done')
  await setBackground($, list => list.map(t => (isOpen(t) && isIt(t) ? { ...t, status: ended, endedAt: t.endedAt ?? at } : t)))
}

// A notification's status that ends its task: present, and not one that says it still runs.
const isFinal = (status: string | undefined): status is string => !!status && !/^(running|pending|in_progress)$/i.test(status)

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
// A command or description on one line.
const oneLine = (v: unknown): string => str(v).replace(/\s+/g, ' ').trim()

// The engine clips a cron's prompt to 1000 chars and appends "… [+N chars]": true when
// `listed` is `prompt`, whole or clipped.
const isClipOf = (listed: string, prompt: string): boolean => {
  const kept = listed.replace(/\s*…\s*\[\+\d+ chars\]$/, '')
  return kept === listed ? listed === prompt : prompt.startsWith(kept)
}

// What a call started in the background, from its input and its result; null when nothing.
const startedTask = (e: Record<string, unknown>, r: Record<string, unknown>): Omit<BackgroundTask, 'startedAt'> | null => {
  if (e.tool === 'Bash' && str(r.backgroundTaskId)) return { id: str(r.backgroundTaskId), kind: 'shell', text: oneLine(e.command), status: 'running' }
  if (e.tool === 'Monitor' && str(r.taskId)) return { id: str(r.taskId), kind: 'monitor', text: oneLine(e.description) || oneLine(e.command), status: 'running' }
  if (e.tool === 'CronCreate' && str(r.id))
    return { id: str(r.id), kind: 'cron', text: oneLine(e.prompt), status: 'scheduled', schedule: str(r.humanSchedule) || str(e.cron) }
  // scheduledFor 0: the wakeup could not be armed.
  if (e.tool === 'ScheduleWakeup' && typeof r.scheduledFor === 'number' && r.scheduledFor > 0 && !r.stopped)
    return { id: `wake:${str(e.prompt)}`, kind: 'wakeup', text: oneLine(e.reason) || oneLine(e.prompt), status: 'scheduled', nextAt: r.scheduledFor }
  return null
}

// One press stops it, no confirmation: TaskStop for a shell or a monitor, CronDelete for a
// cron, ScheduleWakeup's `stop` for a dynamic /loop. An error is toasted and the row stays.
async function stopTask($: EngineInterface, t: BackgroundTask): Promise<void> {
  const consent = `The user pressed Stop on the background ${t.kind} "${clip(bgTitle(t), 80)}" in the Agents panel.`
  const call = t.kind === 'cron' ? { tool: 'CronDelete', id: t.id } : t.kind === 'wakeup' ? { tool: 'ScheduleWakeup', stop: true } : { tool: 'TaskStop', task_id: t.id }
  try {
    const r = await $.tool.call({ ...call, consent } as never)
    if (r.deny !== undefined || r.isError) throw new Error(r.deny ?? r.text ?? str(r.result))
  } catch (err) {
    $.ui.toast(tr().stopFailed(bgTitle(t), err instanceof Error ? err.message : String(err)))
    return
  }
  await finishTask($, x => x.id === t.id, 'killed')
}

// --- terminal drawing: the same rows in text.

const ctxBar = (pct: number, width: number): string => {
  const filled = Math.round((width * pct) / 100)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', planned: '◷' }

// Opens the agents pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: tr().pane })
  return true
}

async function autoOpen($: EngineInterface, key: string): Promise<void> {
  const p = await read($, panel)
  if (p.autoOpenedFor === key) return
  await update($, panel, prev => ({ ...prev, autoOpenedFor: key }))
  void $.ui.open({ id: PANE, title: tr().pane })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    lang = await detectLang($, options.language)
    await $.tool.register({
      name: 'progress',
      description:
        'Report /savvy-flow progress to the progress bar above the prompt and the agents panel. ' +
        'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the overall task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned worker tasks.' },
          done: { type: 'integer', minimum: 0, description: 'Number of tasks accepted after review.' },
          phase: { type: 'string', enum: [...PHASES] },
          finished: { type: 'boolean', description: 'True once the flow is closed.' },
          tasks: {
            type: 'array',
            description:
              'The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, so the panel can match runs to tasks.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'A few words; reused verbatim as the Agent description.' },
                tier: { type: 'string', enum: ['fable', 'heavy', 'careful', 'medium', 'light'] },
                after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
              },
              required: ['title', 'tier'],
            },
          },
        },
      },
    })
    await $.tool.register({
      name: 'step',
      description:
        'For subagents: report progress on your own task to the agents panel. ' +
        'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
        'call it again as each step finishes. Cheap and silent: it only draws a bar, unless you flag `failed` or `blocked`.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
          failed: {
            type: 'boolean',
            description:
              'Set true when an attempt at your task failed (test gate red, fix rejected, build broken). Each call with failed:true counts one failed attempt.',
          },
          blocked: {
            type: 'string',
            description:
              'The question you need answered before you can continue. Set it when you need assistance; your next step call without it clears it.',
          },
        },
        required: ['done'],
      },
    })
    await $.command.register({
      name: 'agents-info',
      description: 'Show or hide the panel of subagents: running, finished and planned, with model, context, cost and time',
    })

    await retick($)
    themePath = `${(await $.env.get('HOME')) ?? ''}/${THEME_FILE}`
    themePoll?.cancel()
    themeEvery = 0
    themeMtime = 0
    await loadTheme($)
    return started
  })

  on('command.run', { command: 'agents-info' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? tr().opened : tr().closed }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as ProgressInput
    const prev = await read($, flow)
    if (isNewFlow(prev, input) && input.title !== undefined) {
      // A new flow starts with a clean list; agents still running stay.
      await update($, agents, list => list.filter(a => a.status === 'running'))
    }
    const next = await update($, flow, p => merge(p, input))
    if (next && input.tasks?.length) await autoOpen($, next.title)
    return { result: `ok: ${label(next ?? blank())}` }
  })

  // A worker's own progress: the call runs in the worker's loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string; failed?: boolean; blocked?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    const s = tr()
    const alerts: string[] = []
    await update($, agents, list => {
      alerts.length = 0
      return list.map(a => {
        if (a.agentId !== agentId) return a
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        const stepDone = total ? Math.min(total, done) : done
        const wasComplete = (a.stepTotal ?? 0) > 0 && (a.stepDone ?? 0) >= (a.stepTotal ?? 0)
        // A successful step ends the failed streak: one that moves done on, or first reaches the total.
        const isProgress = input.failed !== true && (stepDone > (a.stepDone ?? 0) || (total > 0 && done >= total && !wasComplete))
        const run: AgentRun = {
          ...a,
          stepTotal: total,
          stepDone,
          stepNote: input.note?.trim() || undefined,
          failedAttempts: isProgress ? undefined : (a.failedAttempts ?? 0) + (input.failed === true ? 1 : 0) || undefined,
          blocked: (typeof input.blocked === 'string' && input.blocked.trim()) || undefined,
        }
        // Toast on crossings only: a new question, or the third failed attempt.
        if (run.blocked && run.blocked !== a.blocked) alerts.push(`${s.agent} ${run.description}: ${s.toastInput} — ${clip(run.blocked, 120)}`)
        if ((a.failedAttempts ?? 0) < 3 && (run.failedAttempts ?? 0) >= 3) alerts.push(`${s.agent} ${run.description}: ${s.toastFailed(run.failedAttempts ?? 0)}`)
        return run
      })
    })
    for (const alert of alerts) $.ui.toast(alert)
    return { result: 'ok' }
  })

  // Safety net: worker launches move the faint layer even if the orchestrator forgets to report.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = String(e.subagent_type ?? '')
    if (!type.startsWith('savvy-')) return next(e)

    await update($, flow, prev => {
      const base = prev && !prev.isFinished ? { ...blank(), ...prev } : blank()
      return { ...base, running: base.running + 1, phase: base.phase === 'plan' ? 'delegate' : base.phase }
    })
    try {
      return await next(e)
    } finally {
      await update($, flow, prev => (prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev))
    }
  })

  // Background work, never auto-opening the pane: a shell sent to the background, a monitor,
  // a cron or a wakeup; a wakeup's `stop` ends the waiting wakeups.
  on('tool.call', { tool: ['Bash', 'Monitor', 'CronCreate', 'ScheduleWakeup'] }, async ($, e, next) => {
    const r = await next(e)
    const result = !r.isError && r.result && typeof r.result === 'object' ? (r.result as Record<string, unknown>) : null
    const task = result && startedTask(e as unknown as Record<string, unknown>, result)
    // The tool has run: a failed bookkeeping write must not fail its call.
    const record = async () => {
      if (task) {
        const at = await $.clock.now()
        await setBackground($, list => [...list.filter(t => t.id !== task.id), { ...task, startedAt: at }])
      } else if (e.tool === 'ScheduleWakeup' && result?.stopped) await finishTask($, t => t.kind === 'wakeup', 'killed')
    }
    await record().catch(() => undefined)
    return r
  })

  // A background task's notification ends it: `<task-id>` and `<status>` in its text.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      for (const [block] of e.text.matchAll(/<task-notification>[\s\S]*?<\/task-notification>/g)) {
        const tag = (k: string) => new RegExp(`<${k}>([^<]*)</${k}>`).exec(block)?.[1]?.trim()
        const id = tag('task-id')
        const status = tag('status')
        if (isFinal(status)) await finishTask($, t => t.id === id, status).catch(() => undefined)
      }
    }
    return next(e)
  })

  // A new, resumed or cleared session starts with no background rows; the next stop's
  // reconcile adds back what still runs. A compaction keeps them.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source !== 'compact') await setBackground($, () => []).catch(() => undefined)
    return result
  })

  // At each stop the engine lists what is in flight: add what was missed, end what is gone.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    const crons = e.session_crons
    if (!e.background_tasks || !crons) return result
    const live = e.background_tasks.filter(t => t.type === 'shell' || t.type === 'monitor')
    const ids = new Set([...live.map(t => t.id), ...crons.map(c => c.id)])
    // A wakeup's row is keyed by its prompt, which the engine may have clipped.
    const isWakeOf = (id: string) => crons.some(c => isClipOf(c.prompt, id.slice('wake:'.length)))
    const reconcile = async (at: number) =>
      setBackground($, list => {
        const known = new Set(list.map(t => t.id))
        const wakes = list.filter(t => t.kind === 'wakeup').map(t => t.id.slice('wake:'.length))
        const missed: BackgroundTask[] = [
          ...live
            .filter(t => !known.has(t.id))
            .map(t => ({ id: t.id, kind: t.type as 'shell' | 'monitor', text: oneLine(t.command) || oneLine(t.description), status: 'running' as const, startedAt: at })),
          ...crons
            .filter(c => !known.has(c.id) && !wakes.some(p => isClipOf(c.prompt, p)))
            .map(c => ({ id: c.id, kind: 'cron' as const, text: oneLine(c.prompt), status: 'scheduled' as const, startedAt: at, schedule: c.schedule })),
        ]
        const isLive = (t: BackgroundTask) => ids.has(t.id) || (t.kind === 'wakeup' && isWakeOf(t.id))
        return [...list.map(t => (isActive(t) && !isLive(t) ? { ...t, status: 'done' as const, endedAt: at } : t)), ...missed]
      })
    // Bookkeeping after the hooks have run: a failure here must not fail the stop.
    await $.clock.now().then(reconcile).catch(() => undefined)
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    await update($, agents, list => {
      const round = 1 + list.filter(a => norm(a.description) === norm(e.description) && e.description).length
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        type: e.subagentType,
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        contextTokens: 0,
        contextMax: windowOf(started.model),
        tokens: 0,
        costUsd: 0,
        steps: 0,
        round,
      }
      return [...list.filter(a => a.id !== run.id), run].slice(-200)
    })
    await update($, now, () => at)
    await retick($)
    const f = await read($, flow)
    await autoOpen($, f && !f.isFinished ? f.title : 'savvy-flow')
    return started
  })

  // Each model request of a subagent: live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    await update($, agents, list =>
      list.map(a =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running' as const,
              endedAt: undefined,
              contextTokens:
                (usage.input_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.output_tokens || 0),
              contextMax: windowOf(model),
              tokens:
                a.tokens +
                (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0),
              costUsd: a.costUsd + costOf(model, usage),
              steps: a.steps + 1,
            },
      ),
    )
    await retick($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      const at = await $.clock.now()
      await update($, agents, list =>
        list.map(a => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum.
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: e.reason === 'answer' ? ('done' as const) : ('failed' as const),
            endedAt: at,
            // An ended worker can no longer take an answer.
            blocked: undefined,
            ...(fallback && e.usage
              ? {
                  model: e.usage.model || a.model,
                  tokens:
                    e.usage.input_tokens +
                    e.usage.output_tokens +
                    e.usage.cache_read_input_tokens +
                    e.usage.cache_creation_input_tokens,
                  costUsd: costOf(e.usage.model || a.model, e.usage),
                }
              : {}),
          }
        }),
      )
      await update($, now, () => at)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = tr()
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    pal = await read($, theme)
    const list = await read($, agents)
    const f = await read($, flow)
    const p: Panel = await read($, panel)
    const bg = await read($, background)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), ...bg.map(t => t.startedAt), 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const planned = plannedOf(f, list)
    const bgActive = bg.filter(isActive).reverse()
    const bgEnded = bg.filter(x => !isActive(x)).reverse()
    const t = totals(list, at)
    // The pane's title says "Agents"; inside, only the flow's own name.
    const title = f && !f.isFinished ? f.title : ''

    const toggleCompact = (
      <Button
        key="compact"
        label={p.isCompact ? s.expand : s.collapse}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))}
      />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? '▸' : '▾'} ${s.finished} · ${finished.length + bgEnded.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )
    const isEmpty = list.length === 0 && planned.length === 0 && bg.length === 0
    const hasEnded = finished.length + bgEnded.length > 0
    const stopButton = (x: BackgroundTask) => <Button key={`stop-${x.id}`} label={s.stop} plain onPress={() => stopTask($, x)} />
    const flagged = list.filter(needsAttention)
    const summary = `≈${fmtCost(t.cost)}, ${fmtTokens(t.tokens)} ${s.tokensWord}, ${fmtTime(t.time)}`

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const section = (key: string, text: string) => (
        <Text key={key} dimColor>
          {text}
        </Text>
      )
      // The Stop button sits beside the drawing: the desktop would wrap anything inside it.
      const bgCard = (x: BackgroundTask) => (
        <Box key={`bg-${x.id}`} flexDirection="row" alignItems="center" gap={1}>
          <Svg source={bgSvg(W - 56, x, at)} alt={`${bgTitle(x)}: ${bgMeta(x, at)}${x.status === 'failed' ? `, ${s.isFailed}` : ''}`} width={W - 56} height={BG_H} />
          {isActive(x) ? stopButton(x) : null}
        </Box>
      )

      if (p.isCompact) {
        return (
          <Box flexDirection="column" gap={1}>
            <Svg source={compactSvg(W, list, planned, t)} alt={`${list.length} ${s.agentsCount}, ${summary}`} width={W} height={32} />
            {flagged.map(a => (
              <Svg key={`flag-${a.id}`} source={flagSvg(W, a)} alt={agentAlt(a)} width={W} height={20} />
            ))}
            {toggleCompact}
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          <Svg source={headerSvg(W, title, t)} alt={title ? `${title}: ${summary}` : summary} width={W} height={headerHeight(title)} />
          {toggleCompact}
          {isEmpty && <Text dimColor>{s.empty}</Text>}
          {running.length > 0 && section('h-run', `${s.running} · ${running.length}`)}
          {running.map(a => (
            <Svg key={a.id} source={agentSvg(W, a, at)} alt={agentAlt(a)} width={W} height={agentHeight(a)} />
          ))}
          {bgActive.length > 0 && section('h-bg', `${s.background} · ${bgActive.length}`)}
          {bgActive.map(bgCard)}
          {hasEnded && toggleDone}
          {!p.isDoneCollapsed &&
            finished.map(a => (
              <Svg key={a.id} source={agentSvg(W, a, at)} alt={agentAlt(a)} width={W} height={agentHeight(a)} />
            ))}
          {!p.isDoneCollapsed && bgEnded.map(bgCard)}
          {planned.length > 0 && section('h-plan', `${s.planned} · ${planned.length}`)}
          {planned.map(pl => (
            <Svg key={`plan-${pl.n}`} source={plannedSvg(W, pl)} alt={`${pl.n}. ${pl.title}: ${s.isPlanned}`} width={W} height={46} />
          ))}
        </Box>
      )
    }

    // Terminal: the same content in text rows.
    const cols = Math.max(24, e.props.bodyColumns || 40)
    const barW = Math.max(6, Math.min(20, cols - 34))
    // Fixed white on RED (the palette's background on its red): the same contrast on any terminal theme.
    const flagText = (a: AgentRun) => (
      <Text backgroundColor={pal?.red ?? RED} color={pal?.background ?? '#ffffff'} bold>
        {` ${flagOf(a)} `}
      </Text>
    )
    const row = (a: AgentRun) => {
      const tier = tierOf(a.type)
      const color = colorOf(tier)
      const ctx = ctxOf(a)
      const progress = progressOf(a)
      const model = a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model)
      const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' ' + a.stepNote : ''} · ` : ''
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={color}>▣</Text>
            <Text bold wrap="truncate-end">
              {a.description || a.type}
            </Text>
            {needsAttention(a) ? flagText(a) : null}
            <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{STATUS_GLYPH[a.status]}</Text>
          </Box>
          {a.blocked ? <Text wrap="truncate-end">{`  ↳ ${a.blocked}`}</Text> : null}
          <Text dimColor wrap="truncate-end">
            {'  '}
            {tier === 'other' ? a.type : tier} · {model}
            {a.round > 1 ? ` · ${s.round} ${a.round}` : ''}
            {failedHistory(a) ? ` · ${failedHistory(a)}` : ''}
          </Text>
          <Text wrap="truncate-end">
            {'  '}
            {progress === null ? <Text dimColor>{ctxBar(ctx, barW)}</Text> : <Text color={color}>{ctxBar(progress * 100, barW)}</Text>}
            <Text dimColor>
              {' '}
              {steps}ctx {ctx}% · {fmtTokens(a.contextTokens)} ≈{fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
            </Text>
          </Text>
        </Box>
      )
    }

    const bgRow = (x: BackgroundTask) => (
      <Box key={`bg-${x.id}`} flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={accentOf()}>{BG_ICON[x.kind]}</Text>
          <Text bold wrap="truncate-end">
            {bgTitle(x)}
          </Text>
          {x.status === 'failed' ? (
            <Text backgroundColor={pal?.red ?? RED} color={pal?.background ?? '#ffffff'} bold>
              {` ${s.isFailed} `}
            </Text>
          ) : null}
          <Text color={x.status === 'failed' ? 'red' : x.status === 'done' ? 'green' : accentOf()}>{STATUS_GLYPH[bgMark(x)]}</Text>
          {isActive(x) ? stopButton(x) : null}
        </Box>
        <Text dimColor wrap="truncate-end">
          {'  '}
          {bgMeta(x, at)}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          {toggleCompact}
        </Box>
        <Text dimColor>
          ≈{fmtCost(t.cost)} · {fmtTokens(t.tokens)} {s.tokensWord} · {fmtTime(t.time)}
        </Text>
        {p.isCompact ? (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              {[...running, ...finished].map(a => (
                <Text key={a.id} color={colorOf(tierOf(a.type))}>
                  {STATUS_GLYPH[a.status]}{' '}
                </Text>
              ))}
              {planned.map(pl => (
                <Text key={`plan-${pl.n}`} dimColor>
                  ◷{' '}
                </Text>
              ))}
            </Text>
            {flagged.map(a => (
              <Text key={`flag-${a.id}`} wrap="truncate-end">
                {flagText(a)} {a.description || a.type}
                {a.blocked ? ` — ${a.blocked}` : ''}
              </Text>
            ))}
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && <Text dimColor>{s.running} · {running.length}</Text>}
            {running.map(row)}
            {bgActive.length > 0 && <Text dimColor>{s.background} · {bgActive.length}</Text>}
            {bgActive.map(bgRow)}
            {hasEnded && toggleDone}
            {!p.isDoneCollapsed && finished.map(row)}
            {!p.isDoneCollapsed && bgEnded.map(bgRow)}
            {planned.length > 0 && <Text dimColor>{s.planned} · {planned.length}</Text>}
            {planned.map(pl => {
              const tier = pl.tier in TIER_COLOR ? pl.tier : 'other'
              return (
                <Box key={`plan-${pl.n}`} flexDirection="column" marginBottom={1}>
                  <Text dimColor wrap="truncate-end">
                    <Text color={colorOf(tier)}>▢</Text> {pl.n}. {pl.title} ◷
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    {'  '}
                    {tier} · {TIER_MODEL[tier] ?? ''}
                    {pl.after.length ? ` · ${s.after} ${pl.after.join(', ')}` : ''}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    pal = await read($, theme)
    const f = await read($, flow)
    const list = await read($, agents)
    const flagged = list.filter(needsAttention).length
    // With no flow the band still shows up for agents that need attention.
    if ((f === null && !flagged) || e.props.hasSurvey) return next(e)
    // The band sits above what the mods beneath draw (skins' rings, cache-tax), never in its place.
    const theirs = await next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const crew = list.length + plannedOf(f, list).length
    const isWorking = list.some(a => a.status === 'running')
    // ponytail: Button has no accessible-label prop; the visible `×N` is all a reader gets.
    const crewButton = (
      <Button key="savvy-agents" label={`×${crew}`} plain onPress={() => void togglePane($)} />
    )
    const chipText = tr().chip(flagged)
    const chip = !flagged
      ? null
      : e.surface !== 'terminal' && 'Svg' in ui
        ? <ui.Svg key="savvy-chip" source={svg(pillW(chipText), H, pill(0, (H - 15) / 2, chipText))} alt={chipText} width={pillW(chipText)} height={H} />
        : (
            <Text key="savvy-chip" backgroundColor={pal?.red ?? RED} color={pal?.background ?? '#ffffff'} bold>
              {` ${chipText} `}
            </Text>
          )
    if (f === null) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            {chip}
            {crewButton}
          </Box>
          {theirs}
        </Box>
      )
    }
    const percent = `${Math.round(ratio(f) * 100)}%`
    const dismiss = (
      <Button
        key="savvy-dismiss"
        label="✕"
        plain
        role="dismiss"
        onPress={() => update($, flow, () => null)}
      />
    )

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      // About 8 CSS px per reported column; the rest is the count, the dismiss
      // and their gaps. No floor above the slot: a row wider than it would wrap.
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96 - (flagged ? pillW(chipText) + 8 : 0)))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={rowSvg(f, width, isWorking)} alt={`${f.title}: ${label(f)}, ${percent}`} width={width} height={H} />
            {chip}
            {crewButton}
            {dismiss}
          </Box>
          {theirs}
        </Box>
      )
    }

    const cols = e.props.bodyColumns
    const titleW = Math.max(8, Math.min(30, f.title.length + 2, Math.floor(cols / 3)))
    // The chip takes its text, its two padding cells and the row's gap before it.
    const width = Math.max(6, Math.min(40, cols - titleW - 32 - (flagged ? chipText.length + 4 : 0)))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box width={titleW} flexShrink={0}>
            <Text color={f.isFinished ? DONE : accentOf()}>● </Text>
            <Text wrap="truncate-end">{f.title}</Text>
          </Box>
          <Text color={f.isFinished ? DONE : accentOf()}>{barText(f, width)}</Text>
          <Text bold>{label(f)}</Text>
          <Text dimColor>{percent}</Text>
          <Text color={CLAY}>▣</Text>
          {chip}
          {crewButton}
          {dismiss}
        </Box>
        {theirs}
      </Box>
    )
  })
}
