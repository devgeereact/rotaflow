# 04. One design guide for app, console, website and content editor

This is a proposed amendment to [DESIGN.md](../03-design/DESIGN.md), not a second design system. DESIGN.md stays the enforced source of truth. After approval, these rules move into it and this file is deleted.

## 1. Where the product stands (VERIFIED, design audit of 305 `.tsx` files)

The foundation is strong. There are **zero** stock Tailwind palette classes anywhere, one icon set (Lucide), `en-GB` dates throughout (no `en-US`), dark mode in 260 of 277 styled files, and no "Successfully" or "Oops" copy.

The inconsistency comes from primitives that exist but are not used:

| Rule in DESIGN.md                                            | Reality                                                                   | Worst places                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Status backgrounds use `*-wash`, never `success/10` (L82-97) | 78 alpha washes, plus 61 `bg-primary/NN`                                  | `ToastContext.tsx:91-92` (every toast), `ConfirmContext.tsx:88`, `leaveStatus.ts:31-33`, `RotaBuilderPage.tsx:2355-2384`      |
| Status text uses `-ink` with its `-ink-dark` pair (L259-278) | 567 `-ink` against 316 `-ink-dark`, so about 250 lines lack the dark pair | `NotificationsPage`, `ResourcesPage`, `TrustPage`, `SettingsBillingPage`                                                      |
| Icon-only controls use `IconButton` at 44px (L284-288)       | `IconButton` has 2 consumers. 138 raw `<button>` in 71 files              | `RotaBuilderPage` (13), `AdminShell` (7), `NotificationBell.tsx:46` at 34px                                                   |
| Forms use `Field` (label, hint, error)                       | `Field` has 5 consumers; about 45 files wire `Label` and `Input` by hand  | Most settings and modals                                                                                                      |
| Tables use `DataTable`                                       | 9 consumers, all admin. About 11 bespoke tables in the org app            | Leave, Timesheets, Overtime, Availability, Reports                                                                            |
| One status chip                                              | 7 overlapping badge components, 5 with no dark styles                     | `LeaveStatusPill`, `LeaveTypeChip`, `AttendanceStatusBadge`, `SiteStatusBadge`, `ReportChip`, `JobTitleBadge`, `LanguagePill` |
| Type scale: page title, section heading, card heading        | 39 distinct sizes, 23 of them arbitrary (`text-[10px]`, down to 8px)      | `swaps/*`, `reports/*`, `StatTile`, `ProductPreview`                                                                          |
| Dialogs use `Modal`                                          | Four drawers and overlays built by hand                                   | `GlobalSearch.tsx:169-179`, `AdminShell.tsx:408-417`, `Sidebar.tsx:222-231`, `PublicNav.tsx:134-144`                          |
| One header contract (`HeaderBar`)                            | Bespoke `<h1>` in Dashboard, Reports, Notifications, Staff profile        | See [02](02-ORGANISATION-AND-STAFF.md) §5                                                                                     |
| Tokens only, no hex                                          | Chart colours hand-copied as hex                                          | `AdminBillingPage`, `AdminOverviewPage`, `AdminPlatformHealthPage`, `Sidebar.tsx:86`, `ProductPreview.tsx:28`                 |

**The fix is adoption, not invention.** No new component library and no redesign.

## 2. Shared foundation, different density

| Layer          | Organisation app and staff             | Platform console                           | Website                                                          | Content editor (console)                 |
| -------------- | -------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------- |
| Identity       | `BrandMark` plus the organisation name | `BrandMark` plus a clear "Platform" label  | `BrandMark`, company name                                        | Same as console                          |
| Type           | Inter, token scale, semibold           | Same                                       | Inter for body. **One display face for headings** (decision D10) | Same as console                          |
| Density        | Calm, compact rota grid                | Readable directories                       | Generous spacing, editorial                                      | Form-first                               |
| Primary action | One per screen                         | Explicit, scoped, confirmed if destructive | One per section                                                  | Save draft, Publish                      |
| States         | Saved, queued, published, delivered    | Provider, tenant and permission state      | n/a                                                              | Draft, In review, Published, Unpublished |

On D10: DESIGN.md says Inter only, and that is right for the app. The website uses the same single face at bold stock sizes (`text-3xl` to `text-5xl`), which is a large part of why it looks like a template. Allowing one display face for website headings, self-hosted like Inter, changes the site's character without touching the app. Candidates for the owner to choose from: a humanist serif or a characterful grotesk with a free licence. Measure the bundle cost before adopting.

## 3. Component rules

| Element               | Rule                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page header           | `HeaderBar` (or `WorkspaceHeader` / `PageHeader` that wrap it). Title, one line of purpose, one primary action. On phones the primary action stacks first                                       |
| Forms                 | Always `Field`: label, control, hint, error. Required and optional both visible. On failure, focus the first invalid field and keep what was typed                                              |
| Buttons               | `Button` with a verb and an object: "Publish rota", "Add staff". A loading state blocks double submission. A disabled button says why                                                           |
| Icon buttons          | Always `IconButton`, always an `aria-label`. `sm` (36px) only inside dense table rows                                                                                                           |
| Tables                | `DataTable` plus `Pagination`, filters through `useFilterState` and `FilterBar`. On phones, labelled stacked rows or a contained `ScrollRegion`                                                 |
| Status                | One `StatusPill` that takes a tone (neutral, info, success, warning, danger) and a label. The 7 badge variants become thin wrappers or are deleted. Always text plus colour, never colour alone |
| Washes                | `bg-{tone}-wash dark:bg-{tone}-wash-dark`. No alpha fills                                                                                                                                       |
| Dialogs               | `Modal` for every dialog, drawer and overlay. One Close control, Escape, focus trap, scroll lock, focus returns on close                                                                        |
| Empty, loading, error | `EmptyState` with one of four kinds (no records yet, no results for filters, not allowed, failed to load), each with a next action. `LoadingState` with skeletons that match the content        |
| Destructive actions   | Name the exact record, state what is kept and what is lost, then confirm. Routine saves never ask for confirmation                                                                              |
| Charts                | Colours only from `chartPalette`, which reads tokens                                                                                                                                            |

## 4. Enforcement, so this does not drift again

Rules in a document drift. Three cheap checks stop that:

1. An ESLint rule (`no-restricted-syntax`) that flags `bg-(success|warning|danger|info|primary)/[0-9]` and `text-\[` in class strings, with an allowlist for chart files.
2. A test that fails when a file under `src/` contains a hex colour outside the palette files.
3. A test that counts raw `<button>` and fails if the count rises above today's number (a ratchet). Lower the number as screens are fixed.

These follow the existing pattern of `moduleBoundaries.test.ts`: one concrete invariant per check.

## 5. Dates, times, money and numbers

There is no central formatter today, so about 17 date patterns are spread across `date-fns` and `Intl` calls. Add one module, `src/lib/format.ts`, with five functions: `formatDate` (14 Oct 2026), `formatDateLong` (Tuesday 14 October 2026), `formatTime` (09:30), `formatDateTime` (14 Oct 2026, 09:30), and `formatMoney` (re-exported from `lib/money.ts`). Every function takes the organisation time zone. Migrate screens as they are touched, not in one sweep.

## 6. Navigation

Keep current routes and redirects. Group the manager sidebar under four quiet headings, with no new routes:

- **Today:** Dashboard, Attendance, Approvals
- **Planning:** Rota, Schedule, Availability, Open shifts
- **People:** Team, Leave, Swaps, Overtime, Locations
- **Records:** Timesheets, Reports, Announcements

Staff see: My rota, Clock in, Requests (Leave, Swaps, Overtime), Timesheets, Announcements. Settings, My account and Help sit at the bottom for everyone. Phone tab bar: see [02](02-ORGANISATION-AND-STAFF.md) O4 and the rota row in §5. Test the grouping with two managers before shipping it.

## 7. Accessibility and responsiveness

- 44px targets for every standalone control. WCAG 2.2 AA sets its own minimum. Do not describe the 44px product rule as the WCAG requirement.
- Pages reflow at 320px with no sideways scroll. Dense grids use a labelled contained scroll, with a non-drag way to do every action.
- Text readable at 200% zoom. Focus never hidden behind sticky headers, the tab bar or the cookie notice.
- Screen readers hear labels, errors and "Saved" or "Queued" announcements, never every background refresh.
- Reduced motion removes movement as well as duration. No auto-playing video. No animated counters.
- Light and dark both checked, with long names, empty data and errors, not only tidy fixtures.

Automated axe scans are basic evidence, not WCAG conformance. Reference: [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/).

## 8. Words

British English, sentence case, no exclamation marks, no em dashes in UI copy.

| One term            | Not                                                 |
| ------------------- | --------------------------------------------------- |
| Rota                | Schedule (as a noun for the plan)                   |
| My rota             | My schedule                                         |
| Staff               | Employees, workers                                  |
| Organisation        | Company, account, tenant                            |
| Site                | Location (in copy; the route can stay `/locations`) |
| Clock in, Clock out | Clock In, Punch in                                  |
| Swap request        | Shift swap request, swap                            |
| Leave               | Time off, holiday (except "bank holiday")           |
| Publish             | Release, send                                       |
| Cancelled           | Canceled                                            |

| Avoid                      | Use                                                                    |
| -------------------------- | ---------------------------------------------------------------------- |
| Something went wrong       | We couldn't load this week's rota. Check your connection and try again |
| You're all set!            | Your organisation is ready                                             |
| Offline-first everywhere   | Clock-ins can wait on this phone until you're back online              |
| GDPR compliant             | Name the specific control and link to the policy                       |
| Guaranteed cover           | See gaps before you publish                                            |
| AI has scheduled your team | Review the suggested rota before applying it                           |

Fixed state wording stays as DESIGN.md L472-483 defines it: "Saving…", "Changes saved", "Draft · not visible to staff".

## 9. Order of work

1. Status pill and washes (fixes every toast and confirmation at once).
2. `Field` and `IconButton` adoption on the five most-used forms and toolbars.
3. `DataTable` and `useFilterState` on Leave, Timesheets and Overtime.
4. Headers on the four bespoke pages.
5. Dialogs moved onto `Modal`.
6. Arbitrary text sizes mapped to the scale.

Review three representative surfaces first, side by side at phone and desktop width, in both themes: staff My rota and Clock in, manager Rota and Approvals, and the website home page. Once approved, roll the same component fixes across the rest. Record screen status in `SCREENS.md` and dated screenshots as evidence, never as a new style guide.
