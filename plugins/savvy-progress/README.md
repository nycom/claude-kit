# savvy-progress

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the [savvy-flow](../savvy-flow) skill, and useful with any subagents.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, and, at the row's right edge, the crab, a button with the crew size that opens the panel, and ✕. The glow at the fill's head stops once the bar is full. It appears once something reports progress (savvy-flow does) or any subagent starts. With no flow it reads "Claude · 2 agents" (no Tasks pill), then "Claude · 2 done · 1:05" once they end, until your next prompt.
- **Auto-progress**: during a workflow run, agents whose label starts with a planned task's title (the longest matching title wins) move the bar on their own, by the label's next word, as set by the `stages` option: a list of `word=phase[+done][+finish]` entries, where phase is plan, design, delegate, review or close. Default: `implement=delegate`, `review=review`, `fix=review`, `validate=review`, `recheck=review`, `merge=close+done`, `docs=close+finish`. `+done` counts a task done when an agent labelled "<task> <word>" ends with an answer (the agent's turn is all the bar sees, so a merge that answered with a conflict still counts until the coordinator's `progress` `done` corrects it). `+finish` finishes the flow when an agent whose last label word it is ends with an answer, every task is done and no task or `+finish` agent still runs; a failed agent does not. Entries are lower-cased. A bad entry (not `word=phase`, a multi-word word, an unknown phase or marker) is skipped and named once in a load toast, "savvy-progress: ignored stage entry ...". A repeated word: the last wins and the earlier is named in the toast. An empty list means labels move nothing and only `progress` calls move the bar. The validated entries are published as the `stages` state value. Changing the words starts clawpit's per-stage ETA history afresh for new words and leaves orphaned eta keys for removed ones. The delegate skill's labels fit: "<task> implement", "<task> review c1", "<task> merge", "<repo> docs". A task once known done stays done after its agent leaves the list; the flow state value carries those titles as `doneTitles`, normalised rather than as written: lower-cased, with each run of punctuation or spaces turned into one space (so "Docs page." is kept as `docs page`). For a file flow it also carries `source`, the watched file. Phase never goes back and `done` never drops. A `progress` call still overwrites, and one without a title carries on the current flow even after the labels finished it, so the skill's closing `done` and `finished` calls land on it; a new title starts a new flow.
- **Agents panel** (`/agents-info` toggles it; `/agents-info open` opens it or brings it forward without toggling): running, ended and planned subagents with model, effort, task progress, context, estimated cost and time. Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. A worker with a role wears it instead, read from its type's name, then its task: the reviewer ticks a clipboard behind round glasses, the tester's test tube bubbles, the designer paints in a beret, the implementer types at a laptop in a beanie; the card keeps its tier's colour. Explore is always the pirate. `prefers-reduced-motion` stops them. A running agent or background task also carries a status mark that turns like a 33⅓ platter, each out of step with the others. On the desktop only the three most recent running agents animate (then background tasks, if fewer than three agents run); the rest hold their first frame until one of those ends.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks. Only the main session can: a call from a subagent is ignored, so a worker cannot rename, finish or reset the flow.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`), and, with `failed`, why (`reason`, one sentence, clipped to 200 characters) and the exact error line (`error`, clipped to 300). The card's bar shows those steps, in the tier's colour (a plain agent's in its role's colour: implement cyan, review magenta, test lime, design rose, Explore slate); a worker that does not report has no bar, only its time. Each card also shows steps and time ("3/5 · 2:10") and one dim line with context and cost ("ctx 38% · ≈$0.31", or "ctx — · —" before the first request). The tool is listed up front rather than behind ToolSearch, and each `savvy-*` worker gets one line at the end of its brief asking for these reports.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`, list prices as of 2026-10-10), not a bill. Cache writes are priced at the 1-hour rate, which is what Claude Code writes on a subscription; a session that writes 5-minute entries is overestimated there.

## Attention flags

A worker can ask for help through `step`:

- `failed: true` counts one failed attempt (test gate red, fix rejected, build broken); each such call adds one. At three the card is flagged **Failed ×N**, and N keeps counting. The streak resets when a `step` call without `failed` moves `done` on, or newly reaches `done >= total` (including by lowering `total` or setting it for the first time). A plain call that leaves `done` where it was does not reset it.
- `reason` and `error` go with `failed: true`: why this attempt failed, in one sentence (clipped to 200 characters), and the exact error line (clipped to 300). They are one pair: a failed call that gives either replaces both, and one that gives neither keeps the last pair. A `step` call that resets the streak clears them.
- `blocked: "<question>"` flags the card **Needs input** and shows the question under it. The worker's next `step` call without `blocked` clears it.

Only a running worker is flagged. When a run ends the flag goes; a failed streak of three or more stays in the card's meta as **failed ×N**.

A flagged card gets a static red label in the full panel, the compact panel (one extra line per flagged agent) and the terminal rows. The band above the prompt shows a red **⚠ N need(s) attention** chip next to the crew button, even with no flow running. The band draws above the bands of other mods (skins' rings, cache-tax), never in their place.

A toast fires on a crossing only: the failed count reaching three, or a new question (a different one from the question already showing). A single `step` call that does both toasts twice. A fourth failure or the same question again stays quiet; a question asked again after it cleared toasts. The question is cut to 120 characters in the toast.

The main session can need you too. The `sessionNeed` option (string, default `unasked`; options `unasked`, `off`, `both`, `ask`, `tool`) controls this. `unasked` and `off` both mean savvy watches nothing. With `ask` or `both`, while the main session's AskUserQuestion dialog is open, its first question (on one line, cut to 300 characters) becomes the session's need. savvy publishes it in the `need` atom (`{ text, since, source: 'ask' }`, or null when there is none). The panel then starts with one **Needs input** line, "Claude — <question>" (the same line on the terminal), and the band's **⚠ N need(s) attention** chip counts it, even with no flow and no agents. A new question toasts "needs input — <question>", cut to 120 characters. The need clears when the dialog's call returns, at your next prompt (typed, or from the phone), and when a new, resumed or cleared session starts. A compaction keeps it. Questions from a subagent are ignored, and so are dialogs another plugin opens with `$.ui.ask`. Watching the dialog adds no model tokens. With `tool` or `both`, the `progress` tool gains one property, `blocked` (string, the question the main session is waiting on you for; an empty string clears it). A call carrying only `blocked` sets the need atom with source `tool` (text on one line, cut to 300 characters, toast "needs input — <question>" on a new question) and does not start a flow or draw a band title. A subagent's call is ignored. Under `both`, the ask and tool paths both set the need. When the dialog's call returns it clears the need only if that is still the dialog's own question: a need set while the dialog was open stays, and an earlier tool question the dialog replaced does not come back. A `progress` call that repeats the current question keeps its original `since`; a different question starts a new one. This adds about 40 schema tokens to the model's context; under `unasked`, `off` and `ask` the schema is byte-identical to before.

## With clawpit

While the clawpit mod is loaded and has taken over (its `takeover` flag is on), savvy-progress stands down in two places: the band above the prompt draws nothing on the desktop, where clawpit draws its own, and the panel no longer opens by itself. Other surfaces, such as the terminal, keep the band. The auto-open stand-down is session-wide, not per surface (known limit): a terminal attached to the same session gets no auto-open either. The tools, the atoms, the toasts and `/agents-info` keep working.

## Panel behaviour

- The panel opens by itself when any subagent starts, once per flow (not while clawpit has taken over, see above); closing it is not undone until the next flow. The `autoOpen` option set to `savvy` limits that to savvy workers and plans.
- The panel lists Running, then Planned, then Background, and the Ended group last.
- If drawing the panel or the band fails, a dim line says `savvy-progress could not draw this pane: <kind>: <message>` instead of leaving it blank; the band keeps the bands of other mods under it.
- The group of runs that are no longer working is **Ended · N** (done and failed runs alike). Its header collapses it. A run that ends first stays in Running for a moment, with a still done or failed pose and "took m:ss" / "failed after m:ss", until your next prompt (typed, or from the phone over Remote Control; notifications and schedules don't count). Running agents come first, then the 6 that ended last; older finished runs go straight to Ended, so a long unattended run never pushes live work out of view. Then it moves to Ended, which collapses on its own once nothing runs; an expand you make stays until the next run ends. Background shells and monitors don't count as running agents here.
- On the desktop the Ended group shows the 20 that ended last, agents and background rows alike, and a **+K more ended** line for the rest. The desktop drops a whole panel that grows too large, so when the cards would not fit, the panel draws as many as fit and one **+N more running**, **+N more planned** or **+K more ended** line; the terminal lists everything.
- Text colours meet 4.5:1 on the light and dark host backgrounds: per-theme tier colours, darker meta text, dark labels on the coloured pills, white on the red flag.
- A planned task of the `medium` tier is labelled Sonnet.
- After a turn that ends with a `/status` block, the header shows its `STATUS` line and `next gate: <first LEFT item>` (no gate line when nothing is left); a later turn without a block keeps it.

## Background

The panel also lists background work that is not a subagent, under **Background · N**:

- **Shells**: a Bash command run in the background (`run_in_background`, or sent there with Ctrl+B), with its command and running time in whole minutes, "<1m" in the first, then "1m", "2m".
- **Monitors**: the Monitor tool, with its description and running time, in the same minutes.
- **Scheduled**: CronCreate jobs (a `/loop` on an interval included), with the prompt and the schedule, "every 5 minutes"; and ScheduleWakeup (a dynamic `/loop`), with the reason and a countdown, "next in 12m", or "due" once its time has passed.

While no agent runs, running times and countdowns refresh once a minute, so a reading can be a minute behind; a cron alone refreshes nothing, as its schedule doesn't change.

Workflows and subagents are not listed here; their agents are already crabs. A background task never opens the panel by itself, and the compact panel leaves background rows out.

Each running or scheduled row has a **Stop** button, a dim **■** that turns red on hover (ended rows don't); one press stops it, with no confirmation: TaskStop for a shell or a monitor, CronDelete for a cron job, ScheduleWakeup's `stop` for a dynamic `/loop`. If the call fails, the error is toasted and the row stays. Stop goes through Claude Code's normal permission check, so in some permission modes it may ask first or be refused.

A task's completion notification moves it to **Ended** with its duration, and the **Ended · N** count includes it; a failed one gets a red **failed** label there (history only: no attention chip). When Claude stops, the panel matches its rows against the session's in-flight tasks and crons: it adds what it missed and ends what is gone. A row it adds counts its time from that stop, crons show the raw cron expression, and a monitor takes the type the engine lists it under, currently shell. A new, resumed or cleared session starts with an empty list, refilled at the next stop; a compaction keeps the list.

## Crab costumes

The savvy tiers (`fable`, `heavy`, `careful`, `medium`, `light`) each have a costume and a colour; any other subagent is a plain crab, and `Explore` is always the pirate.

A role costume replaces the tier's, and the card keeps the tier's colour. The role is read from the type's name (without a `plugin:` prefix), and only if that finds none, from the task description. The first role that matches wins, in this order:

| Role | Words |
| --- | --- |
| reviewer | review, audit, grill, verify, verification, critique, inspect |
| tester | test, qa, e2e, repro, reproduce |
| designer | design, ui, ux, mockup, impeccable, visual, style |
| implementer | implement, build, fix, add, refactor, code, develop, migrate, wire |

Words match whole, with a common ending (`-s`, `-es`, `-ed`, `-ing`, `-er`, `-ers`); a hyphen ends a match as well, so `claude-code-guide` is no implementer and "fix tests" is a tester.

## Omarchy theme

If `~/.local/state/omarchy/current/theme/colors.toml` exists, the panel and the band take its colours:

| Key | Used for |
| --- | --- |
| `foreground` | text |
| `accent` | the bar and the flow's dot |
| `dark_foreground` (else `muted`) | dim text |
| `red` | the attention flag |
| `selection` | tracks and dividers |
| `dark_background` (else `background`) | flag text |

A missing key keeps its default colour. A file with `mode = "light"` is ignored. On the desktop the text and track colours apply only while the host is in dark mode; `accent` and the terminal colours apply whenever a theme is loaded. The file is checked every 2 seconds while it exists (read again only when it changes) and every 60 seconds while it is missing, so a theme installed later is picked up.

While the skins mod has a dark skin on, its theme wins over the file, and a `/skin` switch redraws the panel and the band at once: its `dim` is the dim text. A light skin behaves like a light host: the file's accent and terminal colours still apply (they are your own pick and are not tied to the mode, with no contrast check against the skin) and none of the dark-mode panel colours are drawn. With the skin off the file applies again. Without skins installed, the file alone applies.

## Settings

`language`: `auto` (default), `en` or `ru`. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or in `~/.claude/settings.json`, keyed `<name>@<marketplace>` as shown (the bare `savvy-progress` key is for a plugin loaded with `--plugin-dir`):

```json
{ "pluginConfigs": { "savvy-progress@claude-kit": { "options": { "language": "ru" } } } }
```

`autoOpen`: `any` (default) or `savvy`. With `any` the panel opens by itself, once per flow, when any subagent starts or a plan is reported. With `savvy` only a `savvy-*` worker or a plan opens it. While clawpit has taken over, neither opens it. `/agents-info` toggles it either way.

`showCost`: boolean, default `true`. When `false`, savvy leaves the approximate cost (the ≈$ figure) out of its own drawing: the compact header, the card dim line (which then reads "ctx 38%" alone), the panel totals line and the summary alt text. The cost is still computed and written to the agents atom.

`sessionNeed`: string, default `unasked`. Whether savvy watches the main session's AskUserQuestion dialog (`ask`), or takes a `blocked` question from the `progress` tool (`tool`), or both; see "Attention flags".

`watch`: string list, default `[]`. It lists globs (`*`, `**`, `?`) of plan files, and a relative glob is resolved against the session's directory. Paths and globs are matched with `\` read as `/`, and a glob that starts with `/`, `\` or a drive letter (`C:\`, `C:/`) is absolute, so Windows paths match too; a file flow's `source` is the path with `/` separators. After the main session Edits or Writes a matching file, its markdown checkboxes become the flow (LF or CRLF line endings): only the shallowest indent counts, the title is the first `# ` heading or else the file name, and the flow finishes when every box is checked. `done` never drops when a box is unchecked, and a new unchecked box reopens a finished flow. A wildcard-free entry is also read at session start if the file exists. A non-finished flow reported through `progress` wins over a file, and an earlier entry outranks a later one, so list a summary file before its detail files. A file flow does not open the agents panel. Edits from subagents, Bash or an outside editor are not seen. Empty: nothing is watched and no hook is registered. Example: `watch: ["docs/plan.md"]`.

`statusWords`: string list, default `[]`, of `word=done`, `word=skip` or `word=<phase>` entries. When a watched file has no checkboxes, a block of `key: word` lines in which one word is configured becomes the tasks: each key is a task, `done` ticks it, `skip` leaves it out, and the furthest phase mapped by a task that is not done sets the phase (forward only). Empty: that shape is never read. Both options add no model tokens.

On Claude Code 2.1.314 the list settings (`stages`, `watch`, `statusWords`) may not show as rows in `/config` (2.1.314 does not draw list settings). Set them in `settings.json` under `pluginConfigs`. An installed plugin's key is `<name>@<marketplace>`; the bare name `savvy-progress` (or `savvy-progress@inline`) applies only to a plugin loaded from a folder with `--plugin-dir`:

```json
{ "pluginConfigs": { "savvy-progress@claude-kit": { "options": { "watch": ["docs/plan.md"], "statusWords": ["finished=done"] } } } }
```

Install instructions are in the [repository README](../../README.md).
