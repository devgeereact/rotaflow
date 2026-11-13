# Hard Coding Rules & Standards

Most of these are enforced by TypeScript, ESLint, Vitest and the CI gates in
`qa/README.md`, and a pull request that fails a required check does not merge.
CodeRabbit also reviews pull requests as a GitHub app, but there is no
`.coderabbit.yaml`, so nothing configures it to check this file specifically. Where a rule is a convention with no lint
rule behind it, it now says so — a rule the tooling does not check is a rule the
codebase will drift from, and several below had.

## 1. Architecture

- **Static front end, PHP API.** The browser app is a static `dist/` (no Node
  server, no SSR). All server logic is the PHP API in `backend/`
  (`backend/public/api/index.php` and `backend/src/Mod/*.php`), on the same
  cPanel host, backed by MariaDB. The host has no Node and no long-running worker
  (scheduled work is cron running `backend/bin/cron.php`). **Server logic is a PHP
  module, or it does not exist.** The Supabase Edge Functions are legacy and
  replaced (`docs/ARCHITECTURE.md`, section 10); do not add one.
- **Respect the folder map** in `docs/ARCHITECTURE.md`. No new top-level folders
  without updating that doc first.
- **No import cycles.** Direction is `pages → services → lib`; components use
  `hooks`/`context`. `lib` imports nothing from `pages`/`components`. _Half
  enforced:_ `src/lib/moduleBoundaries.test.ts` fails on a runtime import from
  `src/services`, `@/lib/api` or `@clerk/*` into `src/lib` (one allowlisted file,
  GAP-114). The `pages`/`components` direction is convention only, and six files
  break it with type-only imports: `clockinDemo`, `reportsDemo`,
  `requestSections`, `settingsTabs`, `staffForm` and `swapRows`.

## 2. TypeScript

- `"strict": true`. **No implicit `any`**, `@typescript-eslint/no-explicit-any`
  is an error.
- Explicit return types on exported functions and all hooks. Enforced by ESLint
  (`@typescript-eslint/explicit-function-return-type`), not by `tsc`.
- Prefer `type`/`interface` over inline anonymous shapes for anything reused.
- Use the `@/` path alias; no deep `../../../` relative imports.

## 3. React

- Function components + hooks only. No class components except `ErrorBoundary`.
- Follow the Rules of Hooks (lint-enforced). Keep `useEffect` deps honest.
- One component per file; name the file after the component (`PascalCase.tsx`).
  _Convention, not lint-enforced; a handful of files export small local siblings._
- Derive state; don't duplicate it. Lift state only as far as needed.

## 4. Styling

- Tailwind 4 utilities **only**. Tokens from the `@theme` block in `src/index.css`.
  NativeWind is not a dependency.
- **No** `.css`/`.module.css` beyond `src/index.css`, which is the Tailwind entry and
  holds the tokens. No CSS-in-JS. Avoid inline `style={{}}` — the
  exception is a genuinely computed value a utility class cannot express (a chart
  bar's height, a progress width). Twenty-two lines in `src` use it (counted on
  9 November 2026 with `git grep -c "style={{"`); anything else belongs
  in a token. _Not lint-enforced._
- Mobile-first: base styles, then `sm:` / `md:` / `lg:` overrides.
- Compose conditional classes with `cn()` (never string-concatenate classes).

## 5. Data & security

- All network access from the browser goes through `src/services/*` over the one
  API client, `src/lib/api.ts` (same-origin `/api`, the Clerk token as Bearer).
  Components don't build requests inline.
- **The API is the guard, not the UI.** Every organisation-scoped handler in
  `backend/src/Mod/*.php` begins with `Scope::membership()`
  (`backend/src/Scope.php`): the organisation id comes from the URL and is never
  trusted, the role is read from the database, a non-member gets 404 and an
  insufficient role gets 403. A handler takes the organisation from the URL and the
  role from the database, never from the request body.
- **Mutations are POST only** (and reads GET): every other verb is refused by
  `backend/public/api/index.php`, and the verb of the change is in the path
  (`backend/src/Api.php`, header).
- **Read request fields through `backend/src/Input.php`** (a value of the wrong
  type reads as absent, never cast) and answer errors with `HttpError`
  (`backend/src/HttpError.php`): a stable code, a short message, no internals.
  Queries use prepared statements (`PDO`, `backend/src/Db.php`).
- **Public routes** (no sign-in; a fourth route element `'public'`) authorise
  themselves and are limited per address (`backend/src/Api.php`).
- **A new route is covered the day it is added.** The access sweep
  (`backend/tests/suites/099-access-sweep.php`) reads the route table from the
  modules and calls every route as nobody, a stranger and a user with no
  organisation; add a test for what the route is allowed to do on top of that.
- **A new table needs a numbered migration** in `backend/migrations`
  (`NNN-name.sql`, additive and re-runnable: an applied file is never edited, a
  changed checksum stops the run; see `backend/bin/migrate.php`) and an `org_id`
  column unless it is platform-level (the style is `backend/migrations/005-rota.sql`).
  `docs/DATA-MODEL.md` is updated in the same change.
- Never ship a secret. Everything in `VITE_*` is public by design and is inlined
  into the bundle whether or not code reads it (`src/lib/env.ts` names the six
  allowed). Stripe's secrets, SMTP credentials, the OpenRouter key, the VAPID
  private key, the Clerk secret key and the database credentials live only in the
  private config outside every web root (`backend/private/config.example.php`
  names them, with placeholders).

## 6. Errors & logging

- No `console.log` in committed code (`warn`/`error` allowed). Use Sentry for
  real telemetry.
- Wrap risky async in `try/catch`; report to Sentry with context, fail gracefully.

## 7. Git & reviews

- Small, atomic commits; imperative messages (`feat: add install prompt`).
- Every PR must pass `typecheck` + `lint` (zero warnings) before review. `pnpm run check`
  is the one local gate.
- **Tooling** (since 2026-10-30): pnpm, Node pinned in `.node-version`, **Biome formats**
  and **ESLint lints**. This deliberately differs from the house kit, which uses Biome
  for both: ESLint here runs the type-checked `typescript-eslint` rules, the explicit
  return-type rule, `jsx-a11y` and the React hooks rules, which Biome does not replace,
  and Biome's own linter added about 260 findings on top of them. Markdown is not
  formatted by any tool. A commit hook runs gitleaks on staged files.
- **Review happens on pull requests.** Use branch → PR → merge. Which CI jobs a
  merge requires is the table in `qa/README.md`; the branch-protection setting
  itself is on GitHub and `NOT VERIFIED` from the repository. CodeRabbit comments
  on pull requests only. Work pushed straight to `main` is never reviewed.
- A pull request that changes behaviour updates the owning document or says
  `Docs: no impact (the reason, in words)` (`AGENTS.md`, "Documentation stays
  current").

## 8. Deploy hygiene (see `docs/DEPLOYMENT.md`)

- Build locally; the server has no Node. A release is `pnpm release` (a dry
  run) then `pnpm release --go` (`scripts/release.mjs`, settings in
  `release.json`): it uploads `dist/`, the PHP API files and the front controller
  over SSH, and never ships the web-root `.htaccess` (that is `pnpm htaccess`).
- Nothing is ever deleted on the server by a release, and every changed server
  file is copied to `~/backups/rotaflow/releases/` first so `pnpm release
  --rollback` can restore it. Do not hand-edit files on the server, and do not
  mirror-with-delete a shared docroot.
- **Never place backups (`*.bak`/`*.zip`/`*.sql`) inside a webroot**. Apache serves
  them as plaintext and leaks their contents. `scripts/release.mjs` never sends `*.sql`
  unless a part lists it (only the private `backend` part in `release.json` does), and
  `backend/bin/backup.php` writes outside every web root (default
  `$HOME/backups/rotaflow/db`).
- Database migrations are not part of the release: they are a separate step on the
  host (`php bin/migrate.php`, `backend/bin/migrate.php`).

## 9. RotaFlow domain rules (project-specific)

- **Multi-tenancy is non-negotiable.** Every domain table carries `org_id`. Every
  query and mutation is scoped to the active organisation, which the browser puts
  in the URL (`/orgs/{o}/...` from `OrgContext`) and the API checks with `Scope`;
  never query across tenants from the client. Platform-level tables are the
  exception, and they are reached only by platform routes.
- **The API is the source of truth for access; role checks in the UI are
  cosmetic.** Never rely on hiding a button for security. The handler must also
  refuse it (`Scope::require`, `backend/src/Scope.php`).
- **Never trust client role state for writes.** `usePermissions` gates UI only; the
  role is read from the database on every request.
- **Never read an empty list as "none exist" without checking whether the load failed.**
  `memberships: []` plus a swallowed error is indistinguishable from a genuinely new
  user — that is how an existing owner was once redirected into `/onboarding` and
  offered a duplicate organisation. `useOrg` exposes `loadFailed` for exactly this;
  check it before branching on emptiness.
- **An access-check change needs a test through the router.** The suites in
  `backend/tests/suites` drive the router (`test_api` in `backend/tests/lib.php`) as
  signed-in test users against a real throwaway MariaDB (`pnpm run test:php`), so a check that hides a row from the
  person who just created it shows up; a unit test of the rule alone cannot see
  that.
- **Naming:** tables and columns are `snake_case`; TS types are `PascalCase`
  (`ShiftSwap`), row aliases live in `src/types/index.ts`. Enum-like columns use the
  exact string sets in the migrations (`status`, `role`, `channel`, `method`) —
  and if a migration and `docs/DATA-MODEL.md` disagree, **the migration wins and the
  document is the bug**. `leave_requests.status` and `shift_swaps.status` both accept
  `'cancelled'` (`backend/migrations/006-time-and-requests.sql`).
- **Times & timezones:** store timestamps as UTC `DATETIME` (the connection is set to
  UTC in `backend/src/Db.php`; the API accepts and returns ISO 8601 with an offset); shift
  times display in the location's timezone. Use `font-mono` for times/hours so columns align.
  `format(new Date(iso), 'HH:mm')` reads the **browser's** zone, which is the wrong
  answer for anybody working away from the site — convert first, with `utcToZoned`
  (`src/lib/zonedTime.ts`) or `toZonedTime` from `date-fns-tz`.
- **A time range is written in one place.** `src/lib/timeRange.ts` owns the
  separator and the overnight marker: `formatTimeRange` for a label,
  `describeTimeRange` inside a sentence or an `aria-label`. Never build one from a
  template literal — eleven screens had drifted to `07:00, 15:00`, which reads as
  two separate times and carries no `(+1 day)` on a night shift (GAP-121).
  `timeRange.test.ts` scans the tree for the twelfth.
- **Offline writes go through the outbox.** Clock-ins, leave requests and swap
  requests use `services/syncQueue` (never a raw insert that silently fails offline).
  Swap and leave responses are review actions and require a network connection.
- **Notifications channel `sms` is reserved, not delivered in V1.** Do not wire a
  Twilio/SMS send; the column value exists (`backend/migrations/007-communication.sql`)
  and `backend/src` has no SMS code.
- **A notification is queued in the same transaction as the event that owes it.**
  Call `Notify::enqueue` (`backend/src/Notify.php`) inside the handler's
  transaction, never after the commit; `backend/src/Dispatcher.php` delivers the
  inbox row, email and push from cron (`docs/NOTIFICATIONS-SPEC.md`). The exception
  is a transactional message such as an invitation, which the handler sends itself
  through `Mail::forOrg` (`backend/src/Mod/Invites.php`).
- **Secrets stay server-side.** SMTP credentials, payment-provider secrets, the
  OpenRouter key, the Clerk secret key and the VAPID private key live only in the
  private config outside every web root (`backend/private/config.example.php`),
  never in the client bundle or a `VITE_` var. A migration or a document never
  holds one either; a commit hook runs gitleaks on staged files
  (`.githooks/pre-commit`).
