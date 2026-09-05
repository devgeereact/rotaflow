# Custom Hooks Specification

Contracts for every reusable hook in `src/hooks`. Signatures here are the source
of truth. Implementations must match.

**Two sections describe hooks that no longer exist**, marked `— REMOVED` with the
date and the reason: `useInngestDispatch` (§5, deleted by `0087`) and
`useOptimizedImage` (§4, deleted 2026-08-31 because nothing imported it). They are
kept deliberately. A hook that was documented as an approved contract and then
vanished invites someone to reintroduce it, and the useful thing to record is not
its signature but why it went. Do not read them as stale entries, and do not
delete them to make this file line up with a directory listing — the check that
matters is that every file in `src/hooks` has a section, which it does.

## 1. `usePWAInstall`

`src/hooks/usePWAInstall.ts`
Captures the deferred `beforeinstallprompt` event and drives the install UI.

```ts
interface UsePWAInstall {
  isInstallable: boolean; // a prompt is available
  isInstalled: boolean; // running in standalone / already installed
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}
export function usePWAInstall(): UsePWAInstall;
```

## 2. `useOnlineStatus`

`src/hooks/useOnlineStatus.ts`
Reactive network connectivity based on `online`/`offline` window events.

```ts
export function useOnlineStatus(): boolean; // true when online
```

## 3. `useSupabaseAuth`

`src/hooks/useSupabaseAuth.ts`
Thin consumer of `AuthContext`. The single source of session truth. The provider
(`src/context/AuthContext.tsx`) owns the listener; this hook exposes it.

```ts
interface UseSupabaseAuth {
  user: User | null;
  session: Session | null;
  loading: boolean; // initial session resolve in flight
  signOut: () => Promise<void>;
}
export function useSupabaseAuth(): UseSupabaseAuth;
```

## 4. `useOptimizedImage` — REMOVED (2026-08-31)

Deleted. It memoised `buildImageKitUrl` and **nothing ever called it** — every
caller that needs a transformed ImageKit URL uses `src/lib/imagekit.ts`
directly, which is a pure string builder and needs no React layer to be cheap.
A documented "approved hook contract" that no component consumes reads as a
rule about how images must be loaded, when it was only an unused wrapper.

`src/lib/imagekit.ts` and its `ImageTransform` type are unchanged and are the
supported way to build one.

## 5. `useInngestDispatch` — REMOVED (0087)

Deleted. Every notification the product owes is now enqueued by the database
in the same transaction as the event that owes it — rota publication (0069),
leave and swap decisions and announcements (0087) — and drained by pg_cron.

Nothing in the app dispatches a notification any more, so there is no hook to
call, and there is no longer a service behind it either:
`src/services/notificationDispatchService.ts` is deleted. This section said it
survived to carry `postInngestEvent` for old queued items; the replay path it
described lives in `src/services/syncQueue.ts` instead, where the `notify`
handler resolves without sending. An item queued by an older install therefore
**drains away** on the next reconnect rather than retrying against a host that
is gone and then sitting in the dead-letter list — the work is not lost, it is
no longer owed, because whatever owed it now enqueues its own row.

See `docs/SAAS.md` GAP-026 for why browser-initiated dispatch was lossy.

## RotaFlow-specific hooks

### 6. `useOrg`

`src/hooks/useOrg.ts`
Consumer of `OrgContext`. The active tenant and the caller's role within it.

```ts
type OrgRole = 'owner' | 'manager' | 'staff';
interface UseOrg {
  orgId: string | null;
  orgName: string | null;
  role: OrgRole | null;
  memberships: { orgId: string; orgName: string; role: OrgRole }[];
  isPlatformAdmin: boolean;
  switchOrg: (orgId: string) => void;
  loading: boolean;
  // Whether the memberships query failed. See the rule below.
  loadFailed: boolean;
  // Additive beyond the original spec. Used by OnboardingPage and anywhere
  // that needs to force a re-fetch (e.g. after an invite is accepted).
  createOrg: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}
export function useOrg(): UseOrg;
```

> **Rule: never treat `memberships: []` as "this user has no organisation"
> without checking `loadFailed` first.** A failed query produces an empty list
> too. Reading one as the other is what sent an existing owner to `/onboarding`
> whenever the app was offline past the 5-minute API cache window, where they
> could create a duplicate organisation. `AppShell` and `OnboardingPage` both
> check `loadFailed && memberships.length === 0` and offer a retry instead.

### 7. `usePermissions`

`src/hooks/usePermissions.ts`
Derives UI capabilities from the active role (client-side gating only; RLS is the
real enforcement).

```ts
interface Permissions {
  canBuildRota: boolean; // owner | manager
  canApprove: boolean; // leave/overtime/swaps
  canManageStaff: boolean; // owner | manager
  canManageOrg: boolean; // owner
  canManagePlatform: boolean; // super admin
}
export function usePermissions(): Permissions;
```

### 8. `useSyncQueue`

`src/hooks/useSyncQueue.ts`
Manages the IndexedDB offline outbox; replays queued writes when back online.

```ts
interface QueuedItem {
  id: string;
  kind: 'clock' | 'leave' | 'swap';
  payload: unknown;
  queuedAt: string;
}
interface UseSyncQueue {
  pending: QueuedItem[];
  /** Writes that will never send themselves. These need a human. */
  deadLettered: DeadLetterRecord[];
  enqueue: (kind: QueuedItem['kind'], payload: unknown) => Promise<void>;
  flush: () => Promise<{ synced: number; failed: number; deadLettered: number }>;
  discard: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  syncing: boolean;
}
export function useSyncQueue(): UseSyncQueue;
```

**When it flushes on its own**, which changed on 2026-09-05 (BUG-077):

1. on reconnect, an offline-to-online transition while mounted;
2. **on mount, when it is already online and the queue is not empty**;
3. on `visibilitychange` back to visible.

Only the first of those existed before, and it is the one that fires least
often. The `online` event only reaches a mounted listener, so the ordinary
case — clock in on a ward with no signal, close the app, walk somewhere with
signal, open it again — flushed nothing at all: the event happened while the
app was closed. The pending list was loaded and rendered, so the person could
*see* their clock-in sitting there, and nothing sent it.

**Mount it once at app scope, not per screen.** `OfflineQueueDrain` does this
inside `AppShell`, so replay is a property of being signed in rather than of
which page is open — the hook used to live only on the clock, leave and swap
screens, and navigating away was enough to strand a write. Feature screens
still call it for `enqueue` and the failed-writes list; the duplicate flush is
harmless, guarded within a tab by an in-flight ref and across tabs by a Web
Lock (`rotaflow:sync-queue`). Without that lock two tabs reconnecting together
each burn an attempt on every transient failure, and a queue that should
survive five retries dies in two.

**It never clears the outbox on sign-out.** That is `lib/session.ts`'s
deliberate omission: the queue holds the only copy of work that has not
reached the server, and signing out is not a statement that you did not clock
in. Ownership answers the shared-device problem instead — every record carries
the id of the user who queued it.

### 9. `useGeolocation`

`src/hooks/useGeolocation.ts`
One-shot device position for GPS clock-in (with permission + accuracy handling).

```ts
interface GeoResult {
  latitude: number;
  longitude: number;
  accuracy: number;
}
interface UseGeolocation {
  request: () => Promise<GeoResult | null>; // null if denied/unavailable
  status: 'idle' | 'prompting' | 'granted' | 'denied' | 'unavailable';
}
export function useGeolocation(): UseGeolocation;
```

### 10. `useToast`

`src/hooks/useToast.ts`
Transient user-facing feedback, rendered by `ToastProvider` (`src/context/ToastContext.tsx`).

```ts
type ToastVariant = 'success' | 'error' | 'info';
interface UseToast {
  toasts: { id: number; variant: ToastVariant; message: string }[];
  showToast: (variant: ToastVariant, message: string) => number; // returns id
  showError: (message: string) => number;
  showSuccess: (message: string) => number;
  dismissToast: (id: number) => void;
}
export function useToast(): UseToast;
```

> **Rule: every user-initiated write reports its failure to the user, not just
> to Sentry.** `reportError` alone leaves the user believing the action worked, > the rota builder silently dropped drag-and-drop shift assignments that way.
> Errors render with `role="alert"` and an 8s dwell; success uses `role="status"`.

### 11. `useRealtimeRefresh`

`src/hooks/useRealtimeRefresh.ts`
Subscribes to Supabase Realtime `postgres_changes` and calls back (debounced)
when data behind the current screen changes, so a published rota or an approved
request appears without a manual reload.

```ts
type RealtimeTable =
  | 'shifts'
  | 'rotas'
  | 'leave_requests'
  | 'shift_swaps'
  | 'notifications'
  | 'announcements'
  | 'clock_events'
  | 'availability'
  | 'staff_profiles'
  | 'invites'
  | 'locations'
  | 'departments'
  | 'shift_types';
interface RealtimeScope {
  column: 'org_id' | 'user_id';
  value: string | null; // null disables the subscription
}
interface UseRealtimeRefreshOptions {
  tables: RealtimeTable[];
  scope: RealtimeScope;
  onChange: () => void;
  enabled?: boolean;
}
interface UseRealtimeRefresh {
  connected: boolean;
}
export function useRealtimeRefresh(o: UseRealtimeRefreshOptions): UseRealtimeRefresh;
```

> **Rule: treat an event as a signal, never as data.** The payload is
> deliberately ignored; `onChange` re-queries through the screen's normal
> RLS-protected path. Realtime does apply RLS to `postgres_changes`, but DELETE
> payloads carry only the primary key and cannot be filtered the way
> INSERT/UPDATE are, so rendering a payload is the one way a row the viewer
> could not otherwise read could reach the screen. Re-querying means the data
> always arrives through a query the database has already authorised.

> **Rule: live updates are an enhancement, never a dependency.** If the socket
> never connects, every screen still loads and refetches exactly as before.
> `connected` is exposed for diagnostics; no screen gates its rendering on it.

Tables must also be in the `supabase_realtime` publication, `0012_realtime.sql`. Adding a table to `RealtimeTable` without adding it there
silently produces a subscription that never fires.

### 12. `useNavBadgeCounts`

`src/hooks/useNavBadgeCounts.ts`
Pending-count badges for the sidebar's Leave and Shift Swaps rows.

```ts
interface NavBadgeCounts {
  leave: number;
  swaps: number;
}
export function useNavBadgeCounts(orgId: string | null): NavBadgeCounts;
```

Both counts come back pre-scoped by RLS: a manager gets the org's pending
queue, a staff member gets only their own still-pending requests. No role
branching in the hook. Polls every 60s rather than subscribing to Realtime —
this mounts on every `/app/*` page via `Sidebar`, and a live channel per tab
for two numbers is more infrastructure than the badge is worth. It would also
collide with `useRealtimeRefresh` channels already open on `LeavePage`/
`SwapsPage` for the same tables.

### 13. `useConfirm`

`src/hooks/useConfirm.ts`
Promise-based confirmation dialog. Must be used inside `ConfirmProvider`
(`src/context/ConfirmContext.tsx`); throws if the provider is missing.

```ts
export function useConfirm(): ConfirmContextValue;
```

### 14. `useFocusTrap`

`src/hooks/useFocusTrap.ts`
Traps focus inside an open drawer or dialog, closes it on Escape, hides the
page behind it from assistive technology (`aria-hidden`), and restores focus
on close. Shared by `Sidebar`'s mobile drawer and the platform console shell
so both get identical, correct behaviour instead of two subtly-different
copies.

```ts
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  containerSelector?: string, // defaults to 'main'
): void;
```

### 15. `useFeatureAccess`

`src/hooks/useFeatureAccess.ts`
What the active organisation may use, and why — one call to
`my_feature_access` per org load rather than a round trip per gate.

```ts
interface FeatureAccess {
  loading: boolean; // gates read false while true
  has: (feature: string) => boolean;
  sourceOf: (feature: string) => 'plan' | 'flag' | null;
  refresh: () => void;
}
export function useFeatureAccess(): FeatureAccess;
```

> **Rule: fails closed.** If the RPC errors, the granted set is empty and
> every gate reads false — deliberately silent, not reported to Sentry (would
> bury real errors on every page load). A gate that renders on a failed check
> is worse than one that stays hidden.

### 16. `useWebPush`

`src/hooks/useWebPush.ts`
Subscribes this device to Web Push, storing the subscription in
`push_subscriptions` for the `send-notification` Edge Function to read.
Requires `VITE_VAPID_PUBLIC_KEY`. The receiving side is `public/push-sw.js`,
imported into the generated service worker (`workbox.importScripts`) — before
2026-08-29 no handler existed and every push the sender signed was silently
discarded by the browser. Delivery has still never been observed on a real
device; see `docs/SAAS.md` ❓-007.

```ts
type WebPushStatus = 'unsupported' | 'default' | 'granted' | 'denied';
interface UseWebPush {
  status: WebPushStatus;
  subscribing: boolean;
  subscribe: (userId: string) => Promise<boolean>;
  unsubscribe: () => Promise<void>;
}
export function useWebPush(): UseWebPush;
```

### 17. `useConsoleRefresh`

`src/hooks/useConsoleRefresh.ts`
How the platform console's topbar Refresh button reaches the screen under it.
A screen _registers_ its refetch via `useRegisterConsoleRefresh`; the shell
renders the button only while something is registered, instead of a dead
button wired to `location.reload()` that would discard filters/tab/scroll
state.

```ts
interface ConsoleRefreshValue {
  refresh: (() => void) | null;
  register: (fn: (() => void) | null) => void;
}
export function useConsoleRefresh(): ConsoleRefreshValue;
export function useRegisterConsoleRefresh(fn: () => void): void; // for screens
```

### 18. `usePageMetadata`

`src/hooks/usePageMetadata.ts`
Everything a browser tab, a search result and a link preview show, for one
public route. Reads the path from the router and looks it up in
`src/lib/publicRoutes.ts`, so a page cannot forget its own description the way
a prop can be forgotten.

Before it, `MarketingLayout` set `document.title` and nothing else: one
`<meta description>` served all sixteen public pages, there was no
`<link rel="canonical">`, no Open Graph and no Twitter card anywhere in the
repository, and the four auth routes and the 404 set no title at all.

```ts
interface PageMetadata {
  title?: string; // overrides the route's own
  description?: string; // overrides the route's own
  noindex?: boolean; // the 404 only — the SPA fallback answers it 200
}
export function usePageMetadata(overrides?: PageMetadata): void;
```

Callers: `MarketingLayout`, `AuthSplitLayout`, `ForgotPasswordPage`,
`ResetPasswordPage`. Only the title is restored on unmount; the tags are
overwritten by whichever route mounts next.

## Conventions

- Every hook is fully typed with an explicit return interface.
- Hooks never read `import.meta.env` directly. They import from `@/lib/env`.
- Side-effectful hooks clean up their listeners in the `useEffect` return.
