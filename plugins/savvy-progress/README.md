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

Only a running worker is flagged. Once it ends the flag goes; a failed streak of three or more stays in the card's meta as **failed ×N**.

A flagged card gets a static red label in the full panel, the compact panel (one extra line per flagged agent) and the terminal rows. The band above the prompt shows a red **⚠ N need(s) attention** chip next to the crew button, even with no flow running. A toast fires on a crossing only: a new question, or the third failed attempt. The same question again, a fourth failure, or a failed streak showing again after a question clears, does not toast; a question asked again after it cleared does.

## Panel behaviour

- The panel opens by itself when any subagent starts, once per flow; closing it is not undone until the next flow.
- The group of runs that are no longer working is **Ended · N** (done and failed runs alike). Its header collapses it.
- Text colours meet 4.5:1 on the light and dark host backgrounds: per-theme tier colours, darker meta and percent text, dark labels on the coloured pills, white on the red flag.
- A planned task of the `medium` tier is labelled Sonnet.

## Settings

`language`: `auto` (default), `en` or `ru`. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

Install instructions are in the [repository README](../../README.md).
