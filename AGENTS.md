# Autonomous AI Agent Directives — RotaFlow

**Project:** RotaFlow — a multi-tenant, offline-first **workforce scheduling PWA**.
Organisations build/manage staff rotas; staff view shifts, clock in, request leave and
swap shifts from any device. Tenants share one Supabase database, isolated by `org_id`
+ Row Level Security.

This repository is edited by humans **and** AI agents (Claude Code, CodeRabbit,
Cursor, etc.). These rules are binding for any automated contribution.

## 1. Read before you write
Before generating or modifying code, load and obey, in this order:
1. `docs/RULES.md` — hard coding standards.
2. `docs/ARCHITECTURE.md` — directory layout and data flow.
3. `docs/SCHEMA.md` — database shape, types, and RLS.
4. `docs/HOOKS.md` — the sanctioned hook contracts.

## 2. Deployment reality (non-negotiable)
The build target is a **static** PWA on Namecheap cPanel (Stellar Plus).
- ❌ No SSR, no Next.js server components, no Node server in this repo — nothing
  that needs a runtime on cPanel.
- ✅ Everything runs in the browser or is offloaded to a managed service. Server-side
  and scheduled logic lives in **Supabase** (Edge Functions, Postgres triggers, RLS);
  media in ImageKit; monitoring in Sentry; background workflows via Inngest.
- The only shippable output is the static `dist/` folder.

## 3. Styling
- Tailwind / NativeWind utility classes **only**.
- No inline `style={{ }}`, no `.module.css`, no styled-components.
- Use the design tokens defined in `tailwind.config.ts` — never raw hex values.

## 4. Data access
- All Supabase reads/writes go through `src/services/*` or `src/lib/supabase.ts`.
- Never bypass Row Level Security. Never embed the `service_role` key.
- Client-exposed keys must be write-scoped or RLS-protected (anon key, ImageKit
  public key, Inngest write-only event key).
- Edge Functions that act on a user's behalf (see `ai-rota-assistant`) should create
  their Supabase client with the caller's forwarded JWT (`Authorization` header), not
  the `service_role` key — RLS then scopes every query to that user's org for free.
  Reach for `service_role` only for genuinely cross-tenant/system work (billing
  webhooks, scheduled jobs), and treat that as the exception, not the default.

## 5. Quality gates (a PR must pass all)
- `npm run typecheck` — zero errors, no implicit `any`.
- `npm run lint` — zero warnings.
- No unused imports/variables, no leaked secrets, no `console.log`.
- `supabase/functions/**` is Deno (npm:/jsr: specifiers) and is excluded from both
  gates above — tsc/ESLint can't parse it. Review those files by hand; there is no
  automated check standing in for you there.

## 6. Scope discipline
Do not invent new top-level folders. If a file doesn't fit the structure in
`docs/ARCHITECTURE.md`, stop and flag it in the PR description instead of
creating ad-hoc directories.

Respect the phased plan: V1 is the core rota loop. Payroll integrations, SSO, the Super
Admin billing console, and live payment charging are **Phase 2** — don't pull them
forward without an explicit decision. SMS is a reserved seam only.

A first slice of AI scheduling — the `ai-rota-assistant` Edge Function (OpenRouter) —
was deliberately pulled forward into V1; see `docs/ARCHITECTURE.md` §9. Auto-fill,
demand forecasting and burnout detection remain Phase 2.

## 6a. Multi-tenancy guardrails (RotaFlow)
- Every domain table has `org_id`; every query is scoped to the active org. Never write
  a cross-tenant query from the client.
- New tables MUST enable RLS with membership-scoped policies (`is_org_member`,
  `has_org_role`) before use — see `docs/SCHEMA.md`.
- UI role checks (`usePermissions`) are cosmetic; RLS is the real guard. Never rely on a
  hidden control for security.
- Server-only secrets (SMTP, payment providers, VAPID private key, Inngest signing key)
  live in Supabase Edge Functions — never a `VITE_` var.

## 7. Deploy reality
The server has no Node — never assume a build step runs there. Ship only `dist/`.
Follow `docs/DEPLOYMENT.md`: deploy into the app's own docroot, never mirror-delete a
shared docroot, keep backups out of every webroot, and don't serve `*.map` publicly.
CodeRabbit only sees pull requests, so raise a PR — never push straight to the default
branch expecting review.
