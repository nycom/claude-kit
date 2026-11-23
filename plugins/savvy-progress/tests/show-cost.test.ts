import { expect, test } from 'claude-code/testing'
import { setup, spawn } from './drawing'
import type { $T, OnT } from './drawing'

const USAGE = { model: 'claude-opus-5-5', input_tokens: 40_000, output_tokens: 2_000, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 0 }
const answers = (on: OnT) =>
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: USAGE } as never
  })
const work = async ($: $T, agentId: string) => {
  for await (const _ of $.turn.step({ turnId: agentId, index: 0, model: USAGE.model, messageCount: 1, agentId } as never)) void _
}

// Every drawn string of the pane: texts, image sources and alts.
const drawn = async ($: $T, surface: string) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } } as never)
  const all = (await ui.findAll({})) as unknown as { text?: string; props?: { alt?: string; source?: string; props?: { source?: string; alt?: string } } }[]
  const out = all.map(n => `${n.text ?? ''}${n.props?.alt ?? ''}${n.props?.source ?? ''}${n.props?.props?.alt ?? ''}${n.props?.props?.source ?? ''}`).join('|')
  await ui.unmount()
  return { out }
}
const drawCompact = async ($: $T) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } } as never)
  await ui.post({ press: true }, { in: 'compact' })
  const all = (await ui.findAll({})) as unknown as { text?: string; props?: { alt?: string; source?: string; props?: { source?: string; alt?: string } } }[]
  const out = all.map(n => `${n.text ?? ''}${n.props?.alt ?? ''}${n.props?.source ?? ''}${n.props?.props?.alt ?? ''}${n.props?.props?.source ?? ''}`).join('|')
  await ui.unmount()
  return out
}

test('showCost false: no drawn text or alt carries the estimate, the card keeps its context', { options: { showCost: false } }, async ($, on) => {
  setup(on)
  answers(on)
  await spawn($, 'schema')
  await work($, 'w1')
  for (const surface of ['desktop', 'terminal']) {
    const { out } = await drawn($, surface)
    expect(out).not.toContain('≈')
  }
  expect((await drawn($, 'desktop')).out).toMatch(/ctx \d+%</)
  expect(await drawCompact($)).not.toContain('≈')
})

test('showCost default: the estimate is drawn at all four sites', async ($, on) => {
  setup(on)
  answers(on)
  await spawn($, 'schema')
  await work($, 'w1')
  const { out } = await drawn($, 'desktop')
  expect(out).toMatch(/ctx \d+% · ≈\$/)
  expect(out).toMatch(/running · ≈\$/)
  const compact = await drawCompact($)
  expect(compact).toContain('≈$')
  expect(compact).toMatch(/>≈\$[\d.]+ · \d+k · /)
  expect(compact).toMatch(/≈\$[\d.]+, \d+k tokens/)
})

test('showCost false: the cost is still written to the agents atom', { options: { showCost: false } }, async ($, on) => {
  const costs: number[] = []
  on('state.set', (_$, e, next) => ((e as { key?: string }).key === 'agents' && costs.push(...((e as { value?: { costUsd: number }[] }).value ?? []).map(a => a.costUsd)), next(e)))
  setup(on)
  answers(on)
  await spawn($, 'schema')
  await work($, 'w1')
  expect(Math.max(...costs)).toBeGreaterThan(0)
})
