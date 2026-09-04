# Codex adapter — RotaFlow

Read **`AGENTS.md`** first. It is the shared contract for every harness and it
routes you to `CLAUDE.md`, which holds the project facts. Nothing in this file
duplicates either; it exists only to map the shared contract onto Codex.

## Where things are

| You need                        | Read                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| The project directives          | `CLAUDE.md`                                                     |
| Routing: mode, workflows, MCP   | `.agent/PROJECT.yml`                                            |
| This task's scope and authority | `.agent/CURRENT-TASK.md`, when present                          |
| What exists and what does not   | `docs/SAAS.md` — the register, and the only place status is set |
| How work is routed here         | `docs/GEE-OS.md`                                                |
| The GEE OS package itself       | `~/.agents/gee-os` on this machine, or `$gee-os` if you have it |

## What differs from Claude Code

- **Subagents.** `.claude/agents/` is Claude Code's mechanism and Codex cannot
  load it. Two agents are defined there: `gee-os` (the router, whose whole
  content is `docs/GEE-OS.md` plus the loop) and `rotaflow-qa-auditor` (whose
  methodology is `docs/Working-Agent.md`). Both are readable as plain documents —
  follow them directly rather than trying to dispatch them.
- **Skills.** The gstack skills named in `.agent/PROJECT.yml` as specialists are
  Claude-side. Where one is unavailable, do the work directly and say in the
  report that the specialist was not used.
- **MCP.** `.codex/config.toml` is gitignored because it holds a machine-specific
  endpoint, so a fresh clone has no Codex MCP configuration at all. Nothing in
  this project depends on that; the shared MCP position in `.agent/PROJECT.yml`
  applies whichever servers happen to be connected, and a server being connected
  never authorises a mutation through it.
- **Commit signing** is configured globally on this machine and applies to Codex
  commits identically.

## What is identical

Everything that matters. The quality gates are npm scripts, the register is a
file, the guardrails are enforced by RLS and CI rather than by a harness, and the
task contract is a document any agent can read and write. If a rule seems to
apply only to Claude Code, it is either a mapping, which belongs here, or a
mistake, which belongs in a pull request.
