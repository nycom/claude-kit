# claude-kit

My public skills and mods for [Claude Code](https://claude.com/claude-code), in one place. A fork of [johnnyvizz/claude-kit](https://github.com/johnnyvizz/claude-kit). Every item is a standalone plugin: install only what you need.

| Plugin | Type | What it does |
| --- | --- | --- |
| [savvy-flow](plugins/savvy-flow) | skill + agents | `/savvy-flow <task>`: the session model plans, delegates to tiered worker subagents and reviews their work. |
| [savvy-progress](plugins/savvy-progress) | mod | A progress bar above the prompt and a live agents panel. Made for savvy-flow, shows any subagents. |
| [session-band](plugins/session-band) | mod | A band above the prompt: turn, speed, cost, prompt cache countdown and context; notifies before the cache expires. |
| [skins](https://github.com/nycom/claude-skins) | mod | Skins for the transcript: themed tool rows, reply gutters and spinner words; `/skin` swaps them live. |
| [filetree](https://github.com/data-goblin/claude-code-filetree) | mod | An IDE-style file tree that shows what Claude is doing, and where in files. |
| [cache-tax](https://github.com/nycom/cache-tax) | mod | Keeps the one-hour prompt cache warm during breaks and warns once before a cold send. |
| [clawpit](https://github.com/nycom/clawpit) | mod | An instrument panel above the prompt and a crew pane beside it, for the desktop app. Installs savvy-progress with it. |
| [clawpit-gauges](https://github.com/nycom/clawpit#gauges-only) | mod | clawpit's gauges above the prompt, without the Agents pane. |

savvy-flow and savvy-progress work on their own and light up together: with both installed, the flow drives the bar and workers report their progress to the panel.

## Install

### From the marketplace

In Claude Code, add the marketplace, then run the lines for the plugins you want:

```
/plugin marketplace add nycom/claude-kit
/plugin install savvy-flow@claude-kit
/plugin install savvy-progress@claude-kit
/plugin install session-band@claude-kit
/plugin install skins@claude-kit
/plugin install filetree@claude-kit
/plugin install cache-tax@claude-kit
/plugin install clawpit@claude-kit
/plugin install clawpit-gauges@claude-kit
```

clawpit is also published by its own marketplace: never enable `clawpit@claude-kit` and `clawpit@clawpit` together.

Restart the session afterwards. Plugin skills and agents are namespaced: the skill is `/savvy-flow:savvy-flow`, the agents `savvy-flow:savvy-careful` and so on.

### By hand

```bash
git clone https://github.com/nycom/claude-kit.git ~/claude-kit
```

**A skill** (no plugin system involved, names stay short: `/savvy-flow`, `savvy-careful`): copy its folders into your Claude Code config.

```bash
cp -R ~/claude-kit/plugins/savvy-flow/skills/savvy-flow ~/.claude/skills/
```

```bash
cp ~/claude-kit/plugins/savvy-flow/agents/*.md ~/.claude/agents/
```

**A mod**: load the folder for one session,

```bash
claude --plugin-dir ~/claude-kit/plugins/savvy-progress
```

or for every session (including the desktop app) through `env` in `~/.claude/settings.json`. Several folders are separated with `:`; if the variable is already set, append to it rather than replacing it:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/claude-kit/plugins/savvy-progress"
  }
}
```

`git pull` in the clone updates a mod loaded this way; copied skills need copying again.

Mods are built on function hooks (`hooks/register.tsx`), an early-access Claude Code API: CI checks them on Claude Code 2.1.330, and the API may change between releases. If a mod installed from the marketplace does not show up, load it by hand as above.

## Try it

With savvy-progress loaded, type this in any session to watch the band and the agents panel play a scripted run: every tier and costume, failures, questions, background tasks and a finish. It takes about 46 seconds and makes no model calls:

```
/agents-info demo
```

For the same show with sillier labels:

```
/agents-info demo fun
```

It ends by itself and puts back what the panel showed before. To stop it sooner, press the band's ✕ or run:

```
/agents-info demo stop
```

It won't start while a real agent runs, and a real subagent or `progress` call stops it. Details: [savvy-progress → Demo](plugins/savvy-progress#demo).

## Layout

```
.claude-plugin/marketplace.json   the catalog `/plugin marketplace add` reads
plugins/<name>/
  .claude-plugin/plugin.json      manifest
  skills/<skill>/SKILL.md         a skill
  agents/*.md                     subagents it ships
  hooks/hooks.json                a mod: points at the hooks module
  hooks/register.tsx              a mod: the module itself
  types/index.d.ts                a mod: its $.state contract
```

Check a plugin before publishing: `claude plugin validate plugins/<name>`, and the catalog with `claude plugin validate .`.

## License

MIT
