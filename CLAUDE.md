# Claude Code — Project Context

**RotaFlow** — a multi-tenant, offline-first **workforce scheduling PWA**. Organisations
build and share staff rotas; staff view shifts, clock in (GPS), request leave and swap
shifts, online or offline. One Supabase database, tenants isolated by `org_id` + RLS.
Roles: Super Admin · Organisation Owner · Manager · Staff.

You are working inside a **static, offline-first PWA** deployed to cPanel.
Treat the constraints below as ground truth for every response.

## Load these first
| Need                         | File                    |
| ---------------------------- | ----------------------- |
| Coding standards             | `docs/RULES.md`         |
| Folder layout & data flow    | `docs/ARCHITECTURE.md`  |
| DB tables, types, RLS        | `docs/SCHEMA.md`        |
| Approved hook contracts      | `docs/HOOKS.md`         |
| Visual/design tokens         | `docs/DESIGN.md`        |
| Product scope & metrics      | `docs/PRD.md`           |
| Deploy process & safety      | `docs/DEPLOYMENT.md`    |

## Hard constraints
- **Static build only.** Output is `dist/`, deployed via Git/FTP to cPanel.
  No server runtime of any kind.
- **TypeScript strict.** No implicit `any`; explicit return types on functions
  and hooks.
- **Styling:** NativeWind / Tailwind classes, tokens from `tailwind.config.ts`.
- **Offloaded systems:** Supabase (Auth/DB + RLS), ImageKit (media), Sentry
  (monitoring), Inngest (background workflows).
- **Path alias:** import app code with `@/…` (maps to `src/`).

## Working style
- Prefer editing an existing file over creating a new one.
- Keep components small and typed; put SDK setup in `src/lib`, data calls in
  `src/services`, reusable logic in `src/hooks`.
- When unsure about the DB shape, re-read `docs/SCHEMA.md` rather than guessing.
