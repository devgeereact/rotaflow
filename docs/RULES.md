# Hard Coding Rules & Standards

Most of these are enforced by TypeScript, ESLint and CodeRabbit, and PRs that
violate an enforced rule do not merge. Where a rule is a convention with no lint
rule behind it, it now says so — a rule the tooling does not check is a rule the
codebase will drift from, and several below had.

## 1. Architecture

- **Static-first on the origin.** The deployed artefact is a static `dist/`; the
  cPanel host runs no application code. No Node server, no SSR, no server
  middleware.
- **Server logic is a Supabase Edge Function, or it does not exist.** Seven live
  in `supabase/functions/` (Deno, excluded from `npm run typecheck`/`lint` — review
  them by hand). This is not an exception to the rule above; it is where the rule
  sends you.
- **Respect the folder map** in `docs/ARCHITECTURE.md`. No new top-level folders
  without updating that doc first.
- **No import cycles.** Direction is `pages → services → lib`; components use
  `hooks`/`context`. `lib` imports nothing from `pages`/`components`. _Convention,
  not lint-enforced — six files currently break it with type-only imports._

## 2. TypeScript

- `"strict": true`. **No implicit `any`**, `@typescript-eslint/no-explicit-any`
  is an error.
- Explicit return types on exported functions and all hooks.
- Prefer `type`/`interface` over inline anonymous shapes for anything reused.
- Use the `@/` path alias; no deep `../../../` relative imports.

## 3. React

- Function components + hooks only. No class components except `ErrorBoundary`.
- Follow the Rules of Hooks (lint-enforced). Keep `useEffect` deps honest.
- One component per file; name the file after the component (`PascalCase.tsx`).
  _Convention, not lint-enforced; a handful of files export small local siblings._
- Derive state; don't duplicate it. Lift state only as far as needed.

## 4. Styling

- Tailwind / NativeWind utilities **only**. Tokens from `tailwind.config.ts`.
- **No** `.css`/`.module.css`, no CSS-in-JS. Avoid inline `style={{}}` — the
  exception is a genuinely computed value a utility class cannot express (a chart
  bar's height, a progress width). Sixteen such uses exist; anything else belongs
  in a token. _Not lint-enforced._
- Mobile-first: base styles, then `sm:` / `md:` / `lg:` overrides.
- Compose conditional classes with `cn()` (never string-concatenate classes).

## 5. Data & security

- All Supabase access via `src/services/*` (or `src/lib/supabase.ts`); components
  don't build raw queries inline.
- Assume RLS is the last line of defense. Still scope every query to the user.
- Never ship a secret. Browser-exposed keys must be write-only or RLS-guarded.
  The `service_role` key, Stripe's secrets and every SMTP credential are
  server-only.

## 6. Errors & logging

- No `console.log` in committed code (`warn`/`error` allowed). Use Sentry for
  real telemetry.
- Wrap risky async in `try/catch`; report to Sentry with context, fail gracefully.

## 7. Git & reviews

- Small, atomic commits; imperative messages (`feat: add install prompt`).
- Every PR must pass `typecheck` + `lint` (zero warnings) before review.
- **CodeRabbit only reviews pull requests**. Use branch → PR → merge. Work pushed
  straight to the default branch is never reviewed.
- **CodeRabbit** checks: no unused vars/imports, correct RLS scoping, no leaked
  credentials or unsanitized keys, adherence to this file.

## 8. Deploy hygiene (see `docs/DEPLOYMENT.md`)

- Build locally; ship only `dist/`. The server has no Node.
- Deploy into this app's own docroot; **never** mirror-with-delete a shared docroot,
  and dry-run any delete first.
- **Never place backups (`*.bak`/`*.zip`/`*.sql`) inside a webroot**. Apache serves
  them as plaintext and leaks their contents. Backups live outside every docroot.

## 9. RotaFlow domain rules (project-specific)

- **Multi-tenancy is non-negotiable.** Every domain table carries `org_id`. Every
  query and mutation is scoped to the active `org_id` from `OrgContext`, never query
  across tenants from the client. Each new table ships with RLS enabled and
  membership-scoped policies (see `docs/SCHEMA.md`).
- **RLS is the source of truth for access; role checks in the UI are cosmetic.** Never
  rely on hiding a button for security. The policy must also forbid it.
- **Never trust client role state for writes.** `usePermissions` gates UI only; the DB
  policy (`has_org_role`, `is_org_member`) is what actually protects data.
- **Never read an empty list as "none exist" without checking whether the load failed.**
  `memberships: []` plus a swallowed error is indistinguishable from a genuinely new
  user — that is how an existing owner was once redirected into `/onboarding` and
  offered a duplicate organisation. `useOrg` exposes `loadFailed` for exactly this;
  check it before branching on emptiness.
- **An RLS-sensitive change needs at least one test as a real signed-in user.**
  Service-role and admin SQL bypass RLS entirely, so they cannot see the class of bug
  where a policy hides a row from the person who just created it. The
  `RETURNING`-visibility defect in `0003` was found this way and by no other.
- **Naming:** tables and columns are `snake_case`; TS types are `PascalCase`
  (`ShiftSwap`), row aliases live in `src/types/index.ts`. Enum-like columns use the
  exact string unions documented in SCHEMA (`status`, `role`, `channel`, `method`) —
  and if the migration and SCHEMA disagree, **the migration wins and SCHEMA is the
  bug**. `leave_requests.status` and `shift_swaps.status` both accept `'cancelled'`.
- **Times & timezones:** store timestamps as `timestamptz` (UTC); shift times display
  in the location's timezone. Use `font-mono` for times/hours so columns align.
- **Offline writes go through the outbox.** Clock-ins, leave requests and swap
  responses use `services/syncQueue` (never a raw insert that silently fails offline).
- **Notifications channel `sms` is reserved, not delivered in V1.** Do not wire a
  Twilio/SMS send; the column value and seam exist for later.
- **Secrets stay server-side.** SMTP credentials, payment-provider secrets and the
  VAPID private key live only in Supabase Edge Function secrets, never in the client
  bundle or a `VITE_` var. The notification shared secret is stricter still: it is
  generated inside Postgres and lives only in `vault` (`0091`), so no human handles
  it and there is no second copy to keep in step.
