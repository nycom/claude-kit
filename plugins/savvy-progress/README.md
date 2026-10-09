# savvy-progress

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the [savvy-flow](../savvy-flow) skill, and useful with any subagents.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, and a button with the crew size that opens the panel. It appears once something reports progress (savvy-flow does) or a `savvy-*` worker starts.
- **Agents panel** (`/agents-info` toggles it): running, ended and planned subagents with model, effort, task progress, context, estimated cost and time. Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. A worker with a role wears it instead, read from its type's name, then its task: the reviewer ticks a clipboard behind round glasses, the tester's test tube bubbles, the designer paints in a beret, the implementer types at a laptop in a beanie; the card keeps its tier's colour. Explore is always the pirate. `prefers-reduced-motion` stops them.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`), not a bill.

## Attention flags

A worker can ask for help through `step`:

- `failed: true` counts one failed attempt (test gate red, fix rejected, build broken); each such call adds one. At three the card is flagged **FAILED ×N**, and N keeps counting. The streak resets when a `step` call without `failed` moves `done` on, or newly reaches `done >= total` (including by lowering `total` or setting it for the first time). A plain call that leaves `done` where it was does not reset it.
- `blocked: "<question>"` flags the card **NEEDS INPUT** and shows the question under it. The worker's next `step` call without `blocked` clears it.

Only a running worker is flagged. When a run ends the flag goes; a failed streak of three or more stays in the card's meta as **failed ×N**.

A flagged card gets a static red label in the full panel, the compact panel (one extra line per flagged agent) and the terminal rows. The band above the prompt shows a red **⚠ N need(s) attention** chip next to the crew button, even with no flow running. The band draws above the bands of other mods (skins' rings, cache-tax), never in their place.

A toast fires on a crossing only: the failed count reaching three, or a new question (a different one from the question already showing). A single `step` call that does both toasts twice. A fourth failure or the same question again stays quiet; a question asked again after it cleared toasts. The question is cut to 120 characters in the toast.

## Panel behaviour

- The panel opens by itself when any subagent starts, once per flow; closing it is not undone until the next flow.
- The group of runs that are no longer working is **Ended · N** (done and failed runs alike). Its header collapses it, and it collapses on its own when the last running agent ends; an expand you make stays until the next run ends. Background shells and monitors don't count as running agents here.
- Text colours meet 4.5:1 on the light and dark host backgrounds: per-theme tier colours, darker meta and percent text, dark labels on the coloured pills, white on the red flag.
- A planned task of the `medium` tier is labelled Sonnet.

## Background

The panel also lists background work that is not a subagent, under **Background · N**:

- **Shells**: a Bash command run in the background (`run_in_background`, or sent there with Ctrl+B), with its command and running time.
- **Monitors**: the Monitor tool, with its description and running time.
- **Scheduled**: CronCreate jobs (a `/loop` on an interval included), with the prompt and the schedule, "every 5 minutes"; and ScheduleWakeup (a dynamic `/loop`), with the reason and a countdown, "next in 12m", or "due" once its time has passed.

Workflows and subagents are not listed here; their agents are already crabs. A background task never opens the panel by itself.

Each running or scheduled row has a **Stop** button (ended rows don't); one press stops it, with no confirmation: TaskStop for a shell or a monitor, CronDelete for a cron job, ScheduleWakeup's `stop` for a dynamic `/loop`. If the call fails, the error is toasted and the row stays. Stop goes through Claude Code's normal permission check, so in some permission modes it may ask first or be refused.

A task's completion notification moves it to **Ended** with its duration; a failed one gets a red **failed** label there (history only: no attention chip). When Claude stops, the panel matches its rows against the session's in-flight tasks and crons: it adds what it missed and ends what is gone. A row it adds counts its time from that stop, crons show the raw cron expression, and a monitor takes the type the engine lists it under, currently shell. A new, resumed or cleared session starts with an empty list, refilled at the next stop; a compaction keeps the list.

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
| `dark_background` (else `background`) | tiles and flag text |

A missing key keeps its default colour. A file with `mode = "light"` is ignored. On the desktop the text, track and tile colours apply only while the host is in dark mode; `accent` and the terminal colours apply whenever a theme is loaded. The file is checked every 2 seconds while it exists (read again only when it changes) and every 60 seconds while it is missing, so a theme installed later is picked up.

While the skins mod has a skin on, its theme wins over the file, and a `/skin` switch redraws the panel and the band at once: its `dim` is the dim text, a light skin keeps the defaults, and with the skin off the file applies again. Without skins installed, the file alone applies.

## Settings

`language`: `auto` (default), `en` or `ru`. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

Install instructions are in the [repository README](../../README.md).
