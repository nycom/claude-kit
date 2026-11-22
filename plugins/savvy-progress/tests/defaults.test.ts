import { expect, mock, test } from 'claude-code/testing'

// Pins what a default session adds to the model's context: every tool and command registration and
// the text appended to a spawn prompt. A change to any of them at default options fails here.
const MAIN = "{\"reg\":[{\"name\":\"progress\",\"description\":\"Report /savvy-flow progress to the progress bar above the prompt and the agents panel. Call it after presenting the plan (title, total, tasks, phase \\\"delegate\\\"), each time a task is accepted (done), when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value. For the main session only: a call from a subagent is ignored (workers report with `step`).\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\",\"description\":\"Short name of the overall task, a few words.\"},\"total\":{\"type\":\"integer\",\"minimum\":0,\"description\":\"Number of planned worker tasks.\"},\"done\":{\"type\":\"integer\",\"minimum\":0,\"description\":\"Number of tasks accepted after review.\"},\"phase\":{\"type\":\"string\",\"enum\":[\"plan\",\"design\",\"delegate\",\"review\",\"close\"]},\"finished\":{\"type\":\"boolean\",\"description\":\"True once the flow is closed.\"},\"tasks\":{\"type\":\"array\",\"description\":\"The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, or start it, so the panel can match runs to tasks.\",\"items\":{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\",\"description\":\"A few words; reused verbatim as the Agent description.\"},\"tier\":{\"type\":\"string\",\"enum\":[\"fable\",\"heavy\",\"careful\",\"medium\",\"light\"]},\"after\":{\"type\":\"array\",\"items\":{\"type\":\"integer\"},\"description\":\"Numbers of the tasks this one waits for.\"}},\"required\":[\"title\",\"tier\"]}}}}},{\"name\":\"step\",\"description\":\"For subagents: report progress on your own task to the agents panel. Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; call it again as each step finishes. Cheap and silent: it only draws a bar, unless you flag `failed` or `blocked`. When an attempt fails, call it with failed: true, reason (one sentence) and error (the exact error line).\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"done\":{\"type\":\"integer\",\"minimum\":0,\"description\":\"Steps finished so far.\"},\"total\":{\"type\":\"integer\",\"minimum\":1,\"description\":\"Steps planned; may change if the plan changes.\"},\"note\":{\"type\":\"string\",\"description\":\"The step in progress, a few words.\"},\"failed\":{\"type\":\"boolean\",\"description\":\"Set true when an attempt at your task failed (test gate red, fix rejected, build broken). Each call with failed:true counts one failed attempt.\"},\"reason\":{\"type\":\"string\",\"description\":\"With failed: why this attempt failed, one sentence.\"},\"error\":{\"type\":\"string\",\"description\":\"With failed: the exact error line, copied verbatim.\"},\"blocked\":{\"type\":\"string\",\"description\":\"The question you need answered before you can continue. Set it when you need assistance; your next step call without it clears it.\"}},\"required\":[\"done\"]},\"isDeferred\":false},{\"name\":\"agents-info\",\"description\":\"Show or hide the panel of subagents: running, finished and planned, with model, context, cost and time\"}],\"prompts\":[\"P\\n\\nProgress reporting: before any other work, call `mcp__savvy-progress__step` with `total` (your plan in 3-8 steps) and `done: 0`; call it again with `done` and a few-word `note` as each step finishes. It only draws a progress bar. When an attempt fails, call it with failed: true, reason (one sentence) and error (the exact error line).\",\"P\",\"P\"]}"

test('default registrations and spawn briefs match the pinned fingerprint', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/k' })
  const reg: unknown[] = []
  const prompts: string[] = []
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('ui.render', (h, e) => h.ui.resolve(e).Text({ children: [''] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.register', (_$, e) => (reg.push(e), { value: undefined }))
  on('command.register', (_$, e) => (reg.push(e), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let n = 0
  on('agent.spawn', (_$, e) => (prompts.push(e.prompt), { model: 'claude-opus-5-5', agentId: `w${++n}` }))
  await $.session.start({ cwd: '/w', source: 'startup' } as never)
  for (const t of ['savvy-worker', 'general-purpose', 'x:implementer'])
    await $.agent.spawn({ tool_use_id: t, prompt: 'P', description: 'fix tests', subagentType: t, provider: 'claude', parentModel: 'x', background: false, fork: false } as never)
  expect(JSON.stringify({ reg, prompts })).toBe(MAIN)
})
