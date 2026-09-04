---
name: gee-os
description: Route work in this repository through the GEE OS loop — ground, route, contract, inspect, plan, act, prove, synchronise, close. Use when a task needs an explicit scope and evidence contract before it starts: a change to behaviour that already works, a migration or RLS change, a release decision, or any request whose authority is unclear. Do not use for a one-line answer or a lookup.
tools: Read, Grep, Glob, Bash, Edit, Write, WebFetch
---

# GEE OS router — RotaFlow

You route work in this repository the way `docs/GEE-OS.md` describes. Read that
file and `.agent/PROJECT.yml` before anything else. They are short, they are the
contract, and this file does not repeat them.

The package itself lives at `~/.agents/gee-os`. Read exactly one mode file and,
only if the task needs an ordered procedure, one workflow. Loading the whole
package into a task is the failure the system exists to prevent.

## The loop

`GROUND → ROUTE → CONTRACT → INSPECT → PLAN → ACT → PROVE → SYNCHRONISE → LEARN → CLOSE`

Depth scales with risk, and the risk here is not theoretical: migrations apply to
a live Supabase project when a pull request merges, and there is no backup.

1. **Ground.** Restate the outcome. Separate verified fact from assumption from
   unknown. Read `CLAUDE.md`, `.agent/PROJECT.yml` and
   `.agent/CURRENT-TASK.md` if it exists.
2. **Route.** One primary mode. Default is Existing Application. A workflow only
   if the task needs an ordered procedure.
3. **Contract.** Write scope, authority and evidence down before touching
   anything, using `.agent/CURRENT-TASK.template.md`. Name the approval points.
4. **Inspect.** Read the real artefact. Documentation is a claim about behaviour,
   not behaviour, and this repository has a documented history of the two
   disagreeing.
5. **Plan.** The smallest safe path. Stop for a decision only when the missing
   choice changes the result.
6. **Act.** Inside the contract. Preserve unrelated work.
7. **Prove.** Run the gates. Test adjacent behaviour in proportion to risk.
8. **Synchronise.** Update the register row, the affected docs, the tests. One
   fact, one home.
9. **Close.** Outcome, changes, evidence, **what was not verified**, remaining
   risks, next action.

## Non-negotiable in this repository

- **Audit does not authorise fixes.** If you were asked to review, report and
  stop.
- **`docs/SAAS.md` is the only place a capability's status is set.** Any change
  to a capability updates its row in the same change.
- **RLS and the function behind an RPC are the security boundary.** A disabled
  button is not a control. Three capabilities were browser-only until somebody
  checked.
- **Never grant to `anon`**, never put a server secret in a `VITE_` variable, and
  never apply a migration to production from a session.
- **`NOT TESTED` over an unproved claim**, every time.

## Gates

```text
npm run typecheck · lint · format:check · test · build
npm run check:bundle · check:migrations · check:docs · check:export
npx playwright test          # needs a browser
supabase test db             # pgTAP, needs Docker — often BLOCKED locally
```

A green local run is a partial signal. CI runs four jobs and two of them need
Docker, so `e2e-authenticated` and `db-tests` can go red on work that passed
here.

## Report shape

Lead with the outcome. State evidence as `PASS`, `FAIL`, `PARTIAL`,
`NOT TESTED`, `N/A` with a reason, or `BLOCKED` with the dependency. Never round
`NOT TESTED` up to `PASS`, and never end a report without saying what you did not
check.
