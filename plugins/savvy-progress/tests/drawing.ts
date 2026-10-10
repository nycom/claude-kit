import { mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// The surface module a looping desktop drawing goes through, as the drawn tree names it.
export const MARK = 'hooks/mark.tsx'

// A drawing's image props: an Svg's own, or a mark Client's (mark.tsx draws its props as an Svg).
export const imgOf = <P>(n?: { type: string; props?: P & { module?: string; props?: P } }): P | undefined =>
  n?.type === 'Svg' ? n.props : n?.props?.module === MARK ? n.props.props : undefined

// What every pane test shares: the types, the props a surface mounts with, a mocked host with a
// frozen clock, and the calls that start and end an agent or a background shell.
export type $T = Parameters<TestBody>[0]
export type OnT = Parameters<TestBody>[1]

export const T0 = Date.UTC(2026, 9, 9, 12, 2, 0)
export const PROPS = { bodyColumns: 120, hasSurvey: false, maxRows: 5 } as never

// The host answers a spawn with w1, w2, ... and a background Bash with b1, b2, ...
export const setup = (on: OnT) => {
  const clock = mock.clock(on, { now: T0 })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let agent = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++agent}` }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  let task = 0
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `b${++task}` } }))
  return clock
}

export const spawn = ($: $T, description: string, subagentType = 'general-purpose') =>
  $.agent.spawn({ tool_use_id: description, prompt: '', description, subagentType, provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
export const end = ($: $T, agentId: string, reason = 'answer') =>
  $.turn.complete({ reason, answer: '', durationMs: 0, isAborted: false, turnId: agentId, agentId } as never)
export const bash = ($: $T, command = 'npm run dev -- --port 5173') => $.tool.call({ tool: 'Bash', command, run_in_background: true } as never)
export const finish = ($: $T, id: string) =>
  $.prompt.submit({
    text: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>`,
    origin: { kind: 'task-notification' },
    wait: false,
  } as never)

// A drawn node, with every prop any test reads.
type Img = { source?: string; alt?: string; width?: number; height?: number }
export type Node = {
  type: string
  key?: string
  text?: string
  props?: Img & { key?: string; module?: string; position?: string; props?: Img & { label?: string } }
  children?: (Node | string)[]
}
