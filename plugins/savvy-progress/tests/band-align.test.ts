import { expect, mock, test } from 'claude-code/testing'

import { imgOf, MARK } from './drawing'

const STEP = 'mcp__savvy-progress__step'

// The desktop band row: the host draws the count and the dismiss as Buttons beside the row's
// image, so the image is the band line's height and everything in it sits on its centre line.
test('desktop band: dot, bar, pill, crab and the attention chip share one centre line', async ($, on) => {
  mock.clock(on)
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w1' }))
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Background tasks in Agents panel', phase: 'delegate', done: 4, total: 5 } as never)
  await $.agent.spawn({ tool_use_id: 't', prompt: '', description: 'fix tests', subagentType: 'general-purpose', provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  await $.tool.call({ tool: STEP, done: 1, blocked: 'Postgres or SQLite?', agentId: 'w1' } as never)

  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  type Img = { source: string; height: number; alt: string }
  const svgs = ((await ui.findAll({})) as unknown as { type: string; props?: Img & { module?: string; props?: Img } }[]).flatMap(n => {
    const props = imgOf(n)
    return props ? [{ props }] : []
  })
  await ui.unmount()
  // The bar's layers (the fill, the twinkle, the pill) share one origin; the crab is beside them.
  const row = svgs.find(s => s.props.alt.startsWith('Background tasks'))
  const layer = svgs.find(s => s.props.source.includes('text-anchor="middle"') && s.props.source.includes('class="tk"'))
  const crabImg = svgs.find(s => s.props.source.includes('class="c-other'))
  const chip = svgs.find(s => s.props.alt.includes('attention'))
  if (!row || !layer || !crabImg || !chip) throw new Error('band row, pill, crab or chip missing')
  for (const img of [layer, crabImg]) expect(img.props.height).toBe(row.props.height)

  // The skins band beside it is 23 tall; the Buttons centre on the band line, so must the images.
  const H = row.props.height
  expect(H).toBe(23)
  expect(chip.props.height).toBe(H)
  const mid = H / 2
  const src = row.props.source
  const num = (re: RegExp, s = src): number => Number(re.exec(s)?.[1] ?? NaN)

  expect(num(/<circle cx="5" cy="([\d.]+)"/)).toBe(mid)

  // The bar and the pill on it: both BAR_H tall, drawn in the bar's translated group.
  const barY = num(/<g transform="translate\([\d.]+,([\d.-]+)\)">\s*<rect class="k"/)
  const barH = num(/<rect class="k" width="[\d.]+" height="([\d.]+)"/)
  const pillH = num(/<rect x="[\d.]+" width="[\d.]+" height="([\d.]+)" rx="[\d.]+" fill=/, layer.props.source)
  expect(num(/<g transform="translate\([\d.]+,([\d.-]+)\)">/, layer.props.source)).toBe(barY)
  expect(barY + barH / 2).toBe(mid)
  expect(barY + pillH / 2).toBe(mid)

  // The crab: its drawn rects' extent, scaled and offset, centres on the line.
  const crab = /<g transform="translate\(([\d.]+),([\d.-]+)\) scale\(([\d.]+)\)"[^>]*>([\s\S]*?)<\/g><\/g>\s*<\/svg>/.exec(crabImg.props.source)
  if (!crab) throw new Error('crab missing')
  const [, , y, scale, body] = crab
  let top = Infinity
  let bottom = -Infinity
  for (const r of body.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)) {
    top = Math.min(top, Number(r[1]))
    bottom = Math.max(bottom, Number(r[1]) + Number(r[2]))
  }
  expect(Math.abs(Number(y) + (Number(scale) * (top + bottom)) / 2 - mid)).toBeLessThan(0.01)

  // The chip's red pill, 15 tall, centred in its own image.
  expect(num(/<rect class="r" x="[\d.]+" y="([\d.]+)"/, chip.props.source) + 7.5).toBe(mid)
})

// A background row: the drawing and the Stop control (a one-line Client region) share a row
// Box. With alignItems center the host centres each child on the row, so the control's centre
// is the row's centre: the taller of the image and the band line, halved.
test('desktop background rows: the platter and every other mark sit on the Stop button centre line', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 2, 0) })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  let n = 0
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `b${++n}` } }))
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'c1', humanSchedule: 'every 5 minutes', recurring: true } }))
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: `job ${i}`, run_in_background: true } as never)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'check the deploy' } as never)
  const notify = (id: string, status: string) =>
    $.prompt.submit({ text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>done</summary>\n</task-notification>`, origin: { kind: 'task-notification' }, wait: false } as never)
  await notify('b2', 'completed')
  await notify('b3', 'failed')

  type Node = { type: string; props: { flexDirection?: string; alignItems?: string; alt?: string; source?: string; height?: number; module?: string; props?: { label?: string; alt?: string; source?: string; height?: number } }; children?: Node[] }
  // A looping mark is a mark Client: its image's props are the Client's.
  const img = (n?: Node) => (n?.props.module === MARK ? { ...n, props: { ...n.props, ...n.props.props } } : n)
  const ui = await $.ui.mount({ plugin: 'savvy-progress', component: 'Pane', requestId: 'savvy-agents', surface: 'desktop', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  // A row: its drawings (the data, then the mark) in a row Box, then the Stop control.
  const rows = ((await ui.findAll({ type: 'Box' })) as unknown as Node[]).filter(b => b.props.alignItems === 'center' && img(b.children?.[0]?.children?.[1])?.props.alt?.length)
  await ui.unmount()
  expect(rows.length).toBe(4)

  const BAND_LINE = 23
  const marks: Record<string, number> = {}
  for (const row of rows) {
    const [drawings, button] = row.children as Node[]
    const [data, markNode] = (drawings?.children ?? []) as Node[]
    const mark = img(markNode) as Node
    expect(mark.props.height).toBe(data.props.height)
    const src = mark.props.source ?? ''
    const ring = /<circle cx="[\d.]+" cy="([\d.]+)" r="[\d.]+" fill="none" stroke="[^"]+" opacity=".3"/.exec(src)
    const done = /<path d="M[\d.]+ ([\d.]+)l3.5 3.5 6.5-7"/.exec(src)
    const failed = /<path d="M[\d.]+ ([\d.]+)l8 8M[\d.]+ [\d.]+l-8 8"/.exec(src)
    const planned = /<circle cx="[\d.]+" cy="([\d.]+)" r="5" fill="none" stroke="#9a9a96"/.exec(src)
    // The check spans y ± 3.5, the cross y - 4 … y + 4: each mark's visual centre.
    const [kind, y] = ring ? ['running', Number(ring[1])] : done ? ['done', Number(done[1])] : failed ? ['failed', Number(failed[1]) + 4] : planned ? ['planned', Number(planned[1])] : ['none', NaN]
    marks[kind] = y
    if (button) {
      expect(button.type).toBe('Client')
      expect(button.props.props?.label).toBe('■')
      expect(row.props.alignItems).toBe('center')
      const buttonCentre = Math.max(mark.props.height ?? 0, BAND_LINE) / 2
      expect(Math.abs(y - buttonCentre)).toBeLessThan(0.5)
    } else {
      // An Ended row has no Stop button; its mark keeps the active rows' line.
      expect(Math.abs(y - (mark.props.height ?? 0) / 2)).toBeLessThan(0.5)
    }
  }
  expect(Object.keys(marks).sort()).toEqual(['done', 'failed', 'planned', 'running'])
})
