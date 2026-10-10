import { expect, mock, test } from 'claude-code/testing'

import { imgOf } from './drawing'

// Which crab a worker wears: Explore's pirate, else a role from its type's name or its task, else its tier's.
test('costumes: roles from the type name or the task, the tier costume otherwise', async ($, on) => {
  mock.clock(on)
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
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
    ['general-purpose', 'reviewing the auth patch', 'review'],
    ['general-purpose', 'testing the parser', 'test'],
    ['general-purpose', 'designing the empty state', 'design'],
    ['general-purpose', 'implementing retries', 'implement'],
    ['general-purpose', 'coding the parser', 'implement'],
    ['general-purpose', 'wiring the hooks', 'implement'],
    ['general-purpose', 'migrating the schema', 'implement'],
    ['general-purpose', 'critiquing the patch', 'review'],
    ['general-purpose', 'reproducing the crash', 'test'],
    // Whole words only: a hyphenated name or a longer word is not the role.
    ['claude-code-guide', 'answer a question', 'other'],
    ['output-style-setup', 'set the tone', 'other'],
    ['general-purpose', 'address the comments', 'other'],
    ['general-purpose', 'update the fixture data', 'other'],
  ]
  // The pane draws only so much at once: ten cards a batch, each batch's agents ended before the next.
  for (let from = 0; from < cases.length; from += 10) {
    const batch = cases.slice(from, from + 10)
    for (const [type, description] of batch)
      await $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType: type, provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never })
    // Each card draws its crab, then its data; a looping crab is a mark Client, its source in its props.
    type Node = { type: string; props?: { source?: string; module?: string; props?: { source?: string } } }
    const cards = ((await ui.findAll({})) as unknown as Node[])
      .map(n => imgOf(n)?.source)
      .filter((src): src is string => src !== undefined)
    for (const [, description, costume] of batch) {
      const i = cards.findIndex(c => c.includes(`>${description}<`))
      expect(i).toBeGreaterThan(0)
      expect(cards[i - 1]).toMatch(new RegExp(`class="c-${costume}( run)?"`))
    }
    await ui.unmount()
    for (let k = from; k < from + batch.length; k++)
      await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: `a${k + 1}`, agentId: `a${k + 1}` } as never)
  }
})
