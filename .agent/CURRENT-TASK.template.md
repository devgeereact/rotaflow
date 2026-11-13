# Current task contract

Copy this to `.agent/CURRENT-TASK.md` at the start of work that changes
anything, fill it in, and delete it when the work closes. That file is
gitignored on purpose: a contract that outlives the task it governed is stale
documentation, and this repository has enough of a history with that.

Every agent working here reads `.agent/CURRENT-TASK.md` when it exists, whether
it is Claude Code, Codex or anything else that reads `AGENTS.md`.

---

## Outcome

_The observable result, in one sentence. Not "improve the rota page" but "a
manager can publish a rota that has an understaffed day and see why it was
refused"._

## Mode

_One. Existing Application, Build, Debug, Audit, Release or Brainstorm._

## Scope

- In scope:
- Out of scope:

## Authority

Say yes or no to each. Silence is not permission, and none of these widen
because the task turns out to be harder than it looked.

- Research and read:
- Write planning artefacts:
- Edit local files:
- Run the app, tests and gates:
- Call external services:
- Change production (deploy, server secret, migration):
- MCP reads permitted:
- MCP mutations authorised (name each one):

## Risk and dependencies

- Risk level: low · medium · high · production
- Affected areas:
- Decisions needed before starting:

## Evidence

The checks that must pass, chosen before the work rather than after it. For
anything in this repository that is usually the list below. A change under `backend/`
adds `check:php`, whose suites need the scratch MariaDB that `scripts/test-db.sh`
starts.

```text
pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm test
pnpm run build && pnpm run check:bundle
pnpm run check:php          # if backend/ changed — php -l, then the PHP suites; needs a scratch MariaDB (scripts/test-db.sh)
pnpm run check:migrations   # reads the legacy supabase/migrations tree only; it does not see backend/migrations
pnpm run check:export       # reads the legacy supabase/migrations tree to find tenant tables
pnpm run check:docs         # if a count or a citation moved
pnpm exec playwright test        # if a screen or a route changed
# a change under backend/migrations: read the new file by hand (additive, re-runnable), then run check:php
```

- Completion conditions:
- Known to be untestable here, and why:

## Closing report

Outcome · changes made · evidence gathered · **what was not verified** · remaining
risks · recommended next action. The fourth item is the one that gets dropped and
the one that matters most.

- Docs updated: _each owning document changed, from the table in
  `docs/README.md`, or one line `Docs: no impact (the reason, in words)`. See
  "Documentation stays current" in `AGENTS.md`._
