# Claude Code — Project Context

**RotaFlow** — a multi-tenant, offline-first **workforce scheduling PWA**. Organisations
build and share staff rotas; staff view shifts, clock in (GPS), request leave and swap
shifts, online or offline. One Supabase database, tenants isolated by `org_id` + RLS.
Roles: Super Admin · Organisation Owner · Manager · Staff.

You are working inside a **static, offline-first PWA** deployed to cPanel.
Treat the constraints below as ground truth for every response.

## Load these first

| Need                      | File                   |
| ------------------------- | ---------------------- |
| Coding standards          | `docs/RULES.md`        |
| Folder layout & data flow | `docs/ARCHITECTURE.md` |
| DB tables, types, RLS     | `docs/SCHEMA.md`       |
| Approved hook contracts   | `docs/HOOKS.md`        |
| Visual/design tokens      | `docs/DESIGN.md`       |
| Product scope & metrics   | `docs/PRD.md`          |
| Deploy process & safety   | `docs/DEPLOYMENT.md`   |
| What is built vs missing  | `docs/SAAS.md`         |

`docs/SAAS.md` is the capability register and the single plan of record. Check a
capability's row there before assuming a feature exists — several documents in this
repo have claimed features that do not, and vice versa. Any PR that changes a
capability's status updates its row in the same PR.

## Hard constraints

- **Static build only.** Output is `dist/`, deployed by rsync over SSH with
  `cpanel-deploy` (see `docs/DEPLOYMENT.md` for the `--keep` flags and the
  `.htaccess` composition). No server runtime of any kind on the origin.
- **TypeScript strict.** No implicit `any`; explicit return types on functions
  and hooks.
- **Styling:** NativeWind / Tailwind classes, tokens from `tailwind.config.ts`.
- **Offloaded systems:** Supabase (Auth/DB + RLS + Edge Functions — the only
  server compute, see `supabase/functions/`), ImageKit (media), Sentry
  (monitoring), Inngest (background workflows), OpenRouter (AI, called only
  from an Edge Function — key never reaches the client), **Stripe** (billing:
  Checkout, Billing Portal and a signature-verified webhook, all three Edge
  Functions; secret and webhook secret never reach the client).
- **OpenRouter is the only AI provider.** Nothing in this project calls
  Anthropic, OpenAI or any other vendor directly. Two callers, both
  server-side: `supabase/functions/ai-rota-assistant` (product AI, keyed by
  the `OPENROUTER_API_KEY` Supabase secret) and
  `scripts/plan-drift-audit.mjs`, run by CI (keyed by the
  `OPENROUTER_API_KEY` **GitHub Actions** secret — same name, different
  store). Model defaults to `openai/gpt-4o-mini`, overridable via
  `OPENROUTER_MODEL`. If you add AI anywhere, it goes through OpenRouter.
- **Path alias:** import app code with `@/…` (maps to `src/`).

## Multi-tenancy guardrails

These were in `AGENTS.md` until 30 August 2026, when the two files were merged —
they are the rules most expensive to get wrong, and they belong where the agent
actually reads them.

- Every domain table carries `org_id`, and every query is scoped to the active
  org. Never write a cross-tenant query from the client.
- A new table enables RLS with membership-scoped policies (`is_org_member`,
  `has_org_role`) **before** it is used. See `docs/SCHEMA.md` §5.
- UI role checks (`usePermissions`) are cosmetic. **RLS is the guard, and so is
  the database function behind an RPC** — a control whose only enforcement is a
  disabled button is not a control. That sentence has been earned repeatedly:
  plan limits (`0070`), the AI entitlement (`0074`) and minimum cover (`0080`)
  were all enforced only in the browser until someone checked.
- Server-only secrets — SMTP, Stripe, the VAPID private key, the Inngest signing
  key — live in Supabase Edge Function secrets. Never a `VITE_` variable, which
  is compiled into the bundle every visitor downloads.
- `anon` holds nothing in `public` beyond schema usage and one function grant
  (`0075`). If you find yourself granting to `anon`, that is a decision to argue
  for in the PR, and CI will ask you to write down why.

## Data access

- All Supabase reads and writes go through `src/services/*` or
  `src/lib/supabase.ts`. No component calls `supabase.from(...)` directly.
- An Edge Function acting on a user's behalf builds its client with the
  **caller's forwarded JWT**, so RLS scopes every query for free. `service_role`
  is for genuinely cross-tenant work — billing webhooks, scheduled jobs — and is
  the exception, never the default. `ai-rota-assistant` is the worked example:
  JWT for everything, `service_role` for the single `audit_write` call that
  `authenticated` is deliberately not allowed to make.

## Quality gates

Every one of these runs in CI and blocks a merge:

| Gate                       | What it catches                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        | implicit `any`, missing return types                                                                        |
| `npm run lint`             | zero warnings tolerated (`--max-warnings 0`)                                                                |
| `npm run format:check`     | a separate gate from lint; green tsc/eslint does not imply it                                               |
| `npm test`                 | pure-logic unit suite over `src/lib`, `src/services`, and any pure module extracted out of an Edge Function |
| `npm run check:bundle`     | size budgets, and that no DEV preview page shipped                                                          |
| `npm run check:migrations` | destructive SQL without a `-- SAFETY(...)` declaration                                                      |
| `npx playwright test`      | 40 screens rendered and scanned for WCAG basics                                                             |
| `supabase test db`         | pgTAP, the only gate that can catch an RLS regression                                                       |

`supabase/functions/**` is Deno and is excluded from typecheck and lint — no
automated check stands in for reading those files. The exception is a module
with no Deno globals in it, which vitest can run unchanged: `ai-rota-assistant/
grounding.ts` is the worked example, and extracting the decision-making part of
a function that way is preferred to leaving it untested inside the handler.

## Scope discipline

Do not invent top-level folders. If a file does not fit `docs/ARCHITECTURE.md`,
say so in the PR rather than creating an ad-hoc directory.

Phase 2, unless a decision says otherwise: SSO/SCIM, a public API, outbound
webhooks, payroll integrations, per-tenant branding. SMS is a reserved seam.
**Billing is not Phase 2 any more** — Stripe Checkout, the Billing Portal and a
signature-verified webhook all ship, and the platform billing console is built.
`AGENTS.md` said otherwise until this merge, which is the kind of drift the
register exists to catch.

## Working style

- Prefer editing an existing file over creating a new one.
- Keep components small and typed; put SDK setup in `src/lib`, data calls in
  `src/services`, reusable logic in `src/hooks`.
- When unsure about the DB shape, re-read `docs/SCHEMA.md` rather than guessing.
- Edge Functions acting on a user's behalf should forward the caller's JWT into
  their Supabase client (see `supabase/functions/ai-rota-assistant`) so RLS
  scopes queries — not the `service_role` key. `supabase/functions/**` is Deno
  and excluded from `npm run typecheck`/`lint`; review it by hand.

# gstack

Installed at `~/.claude/skills/gstack`. Run `~/.claude/skills/gstack/setup` after
cloning it if the skills aren't registered yet.

## Web browsing

Use the `/browse` skill from gstack for **all** web browsing. Never use the
`mcp__claude-in-chrome__*` tools.

## Available skills

`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`,
`/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`,
`/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`,
`/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`,
`/setup-gbrain`, `/retro`, `/investigate`, `/document-release`,
`/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`,
`/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`,
`/gstack-upgrade`, `/learn`.
