import { expect, mock, test } from 'claude-code/testing'

// Which crab a worker wears: Explore's pirate, else a role from its type's name or its task, else its tier's.
test('costumes: roles from the type name or the task, the tier costume otherwise', async ($, on) => {
  mock.clock(on)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }))
  const cases: [type: string, description: string, costume: string][] = [
    ['Explore', 'review the auth flow', 'explore'],
    ['impeccable-finish-reviewer', 'finish pass', 'review'],
    ['general-purpose', 'Review PR 42', 'review'],
    ['general-purpose', 'fix the flaky tests', 'test'],
    ['savvy-medium', 'design the onboarding', 'design'],
    ['general-purpose', 'implement the cache layer', 'implement'],
    ['savvy-heavy', 'hunt the race condition', 'heavy'],
    ['general-purpose', 'summarise the thread', 'other'],
  ]
  for (const [type, description] of cases)
    await $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType: type, provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
  const cards = (await ui.findAll({ type: 'Svg' })).map(s => String((s as { props: { source: string; alt: string } }).props.source))
  for (const [, description, costume] of cases) {
    const card = cards.find(c => c.includes(`>${description}<`))
    expect(card).toBeDefined()
    expect(card).toMatch(new RegExp(`class="c-${costume}( run)?"`))
  }
  await ui.unmount()
})
