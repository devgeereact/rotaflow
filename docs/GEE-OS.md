# GEE OS in this repository

RotaFlow adopts GEE OS as of 4 September 2026. `PROJECT.yml` at the repository
root is the adoption; this file is the record of what that means here, what it
deliberately leaves out, and which conflicts had to be settled before it could
be switched on.

GEE OS lives at `~/.agents/gee-os` on the owner's machine and is not vendored
into this repository. It is a shared working system rather than a library:
a constitution, a set of single-purpose modes, ordered workflows, and an
evidence standard that Claude Code, Codex and any other agent reading
`AGENTS.md` can follow identically. Its own rule is that adoption is explicit,
so nothing changed here merely because the package existed.

## Why adopt it at all

This repository already has more process than most: a capability register that
is the single plan of record, ten CI gates, a QA auditor agent with its own
spec, and a `CLAUDE.md` that reads like a set of scars. What it did not have was
a way to say, before work starts, **what this particular task is allowed to do
and what would count as proof that it worked**.

That gap is visible in the register. Several of its most expensive entries share
one shape: a control that was enforced in the browser and nowhere else
(`0070`, `0074`, `0080`), a secret held in two places that drifted (`0091`), a
scheduled check that fails where nobody is standing. None of those were caused
by a missing rule. They were caused by work that finished before anyone asked
what would prove it.

GEE OS contributes exactly three things this repository lacked:

1. A **task contract** written before the work, naming authority and evidence.
2. An **evidence vocabulary** with `NOT TESTED` in it, so an unproved claim has
   somewhere honest to go instead of being rounded up to "done".
3. A **release gate** that is recorded rather than remembered, in
   `docs/PWA-RELEASE-GATES.md`.

Everything else it offers, this project already had, and duplicating it would
have made the second copy the one that drifts.

## The loop, scaled to this repository

The GEE Loop is `GROUND → ROUTE → CONTRACT → INSPECT → PLAN → ACT → PROVE →
SYNCHRONISE → LEARN → CONTINUE OR CLOSE`. Its depth scales with risk, and in a
repository whose migrations apply to a live database on merge, the scale is not
theoretical:

| The work                                     | Required depth                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Answering a question, reading code           | Ground, inspect, prove the sources, close. No edits.                                           |
| A component, a style, a piece of copy        | Full loop, checks focused on the changed screen                                                |
| Anything touching `src/services` or an RPC   | Full loop, plus the adjacent behaviour that shares the service                                 |
| A migration, an RLS policy, a grant          | Full loop, plus impact analysis, plus pgTAP; Docker is not optional                            |
| A deploy, a Supabase secret, a Stripe change | Full loop, explicit approval, rollback stated before the change, then post-change verification |

The one rule that carries most of the value: **discussion, review and diagnosis
do not authorise edits.** Being asked what is wrong with something is not being
asked to change it.

## Routing

One primary mode per task. The default is `EXISTING-APPLICATION`, which is the
mode for improving a live system without losing behaviour that already works.

| Request                             | Mode                 | Workflow                                                  |
| ----------------------------------- | -------------------- | --------------------------------------------------------- |
| Change something that already works | Existing Application | `workflows/CHANGE-SAFETY.md`                              |
| Build an approved capability        | Build                | `workflows/CHANGE-SAFETY.md`                              |
| A defect with a clear reproduction  | Debug                | Defect workflow in `EXISTING-APP-ENGINE.md`               |
| A failure nobody understands yet    | Debug                | `/investigate`, then the defect workflow                  |
| Review code or a screen             | Audit                | `/review`; audit does not authorise fixes                 |
| A full QA pass                      | Audit                | `rotaflow-qa-auditor`, spec in `docs/Working-Agent.md`    |
| Prepare a deploy                    | Release              | `workflows/RELEASE-GATE.md` + `docs/PWA-RELEASE-GATES.md` |
| Explore an idea                     | Brainstorm           | None. No edits.                                           |

Load one mode file and one workflow. Loading the whole package into a task is
the failure GEE OS exists to prevent.

## The task contract

Before work that changes anything, write this down. It belongs in the session,
not in the repository: a contract that survives the task it governed becomes
stale documentation, and this project has a rule about that.

```text
Outcome:      the observable result, in one sentence
Mode:         one
Scope:        in / out
Authority:    research · planning · local edits · external services · production
MCP:          reads permitted · mutations authorised (name each)
Risk:         level, affected areas, decisions needed before starting
Evidence:     the checks that must pass, and what "done" looks like
```

The authority line is the point. "Fix the failing test" authorises a local edit;
it does not authorise deploying, editing a Supabase secret, or applying a
migration to production, and none of those become authorised because the task
turned out to be harder than expected.

## Evidence

GEE OS uses `PASS`, `FAIL`, `PARTIAL`, `NOT APPLICABLE`, `NOT TESTED` and
`BLOCKED`. This repository already had a status vocabulary for capabilities, in
`docs/SAAS.md` §1, and the two are not competitors: the register describes **a
capability's standing over time**, while the GEE statuses describe **one check on
one day**. Both are kept, with a fixed mapping so a gate result can be read into
the register without anyone inventing a translation:

| Gate result on a capability's critical checks | Register mark             |
| --------------------------------------------- | ------------------------- |
| Every check `PASS`                            | 🟢                        |
| Mixture of `PASS` and `PARTIAL`               | 🟡                        |
| A `FAIL` on a claim the product makes         | 🟠                        |
| Nothing beyond schema or UI proved            | ⚪                        |
| Any critical check `NOT TESTED`               | ❓                        |
| `BLOCKED` on a dependency, reason recorded    | ❓ with the blocker named |

`docs/SAAS.md` remains the plan of record and the only place a capability's
status is set. Gate files record evidence; they do not grant status.

A completion report states, in this order: outcome, changes made, evidence
gathered, what was not verified, remaining risks, recommended next action. The
fourth item is the one that gets dropped, and it is the one that matters most,
because a report with no "not verified" section is read as though everything was.

## Conflicts settled at adoption

**1. `AGENTS.md` versus `CLAUDE.md`.** The GEE template makes `AGENTS.md` the
shared project contract and `CLAUDE.md` a thin adapter. This repository does the
opposite, and did it on purpose: until 30 August 2026 `AGENTS.md` held a near
duplicate of the same rules, the two drifted, and `AGENTS.md` was still calling
shipped billing "Phase 2". The inversion stands. `CLAUDE.md` is canonical because
the harness loads it whether or not anybody remembers to, `AGENTS.md` points at
it, and `PROJECT.yml` records which is which so no agent has to guess.

**2. Four routers, one task.** GSD, gstack, the superpowers skills and GEE OS all
describe how to sequence work, and three of them are installed here. The rule
from `registry/CONFLICTS.md` applies: the primary routed skill owns the task and
the others answer bounded questions. In this repository GEE OS routes, and the
gstack skills named in `PROJECT.yml` are specialists it calls, not alternatives
to it. A user asking for `/review` or `/qa` by name has routed the task
themselves, which outranks this file.

**3. Audit mode does not authorise fixes.** Worth stating separately because the
habit here has been to find and fix in one motion. Where that is wanted, the task
contract says so explicitly.

## Deliberately not adopted

- **`templates/new-project/`**, the Full Product documentation blueprint: 35
  documents across ten numbered directories, plus a `qa/` tree. Scaffolding it
  would create a sixth plan of record five days after five were merged into
  `docs/SAAS.md` to stop exactly that. The blueprint is for new projects.
- **`standards/ENGINEERING-RULES.md`** as a file: its eight rules are cited, not
  copied. `docs/RULES.md` is the enforced standard and several of its rules are
  machine-checked, which the GEE copy would not be.
- **`workflows/PROJECT-RECOVERY.md`**: recovery is for an abandoned or widely
  broken system. This one has passing gates and a register that tracks its own
  gaps.
- **`systems/website/`** and the website launch audit: superseded here by the PWA
  gate, which covers the marketing surface as part of the same build.
- **Copying source prompts into the repository.** GEE OS keeps its originals for
  traceability. They stay there.

## What this changed on day one

Adoption is a filing exercise unless it produces a fact somebody did not have.
It produced two, both by asking questions the existing gates never asked:

- `docs/OFFLINE-SPEC.md` now classifies each feature area by what it actually
  does without a network. The product has described itself as offline-first in
  `package.json`, in `CLAUDE.md` and on the marketing site, and no document had
  ever said which features that covers.
- `docs/PWA-RELEASE-GATES.md` records the release evidence, including the lines
  that are `FAIL` and `NOT TESTED` today. Some of them were already known and
  written down elsewhere; the gate is the first place they are counted against a
  release decision rather than listed as gaps.
