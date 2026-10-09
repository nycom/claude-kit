import { expect, mock, test } from 'claude-code/testing'

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
  const svgs = (await ui.findAll({ type: 'Svg' })) as unknown as { props: { source: string; height: number; alt: string } }[]
  await ui.unmount()
  const row = svgs.find(s => s.props.alt.startsWith('Background tasks'))
  const chip = svgs.find(s => s.props.alt.includes('attention'))
  if (!row || !chip) throw new Error('band row or chip missing')

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
  const pillH = num(/<rect x="[\d.]+" width="[\d.]+" height="([\d.]+)" rx="[\d.]+" fill=/)
  expect(barY + barH / 2).toBe(mid)
  expect(barY + pillH / 2).toBe(mid)

  // The crab: its drawn rects' extent, scaled and offset, centres on the line.
  const crab = /<g transform="translate\(([\d.]+),([\d.-]+)\) scale\(([\d.]+)\)"[^>]*>([\s\S]*?)<\/g><\/g>\s*<\/svg>/.exec(src)
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
