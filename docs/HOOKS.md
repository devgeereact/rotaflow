# Custom Hooks Specification

Contracts for every reusable hook in `src/hooks`. Signatures here are the source
of truth — implementations must match.

## 1. `usePWAInstall`
`src/hooks/usePWAInstall.ts`
Captures the deferred `beforeinstallprompt` event and drives the install UI.
```ts
interface UsePWAInstall {
  isInstallable: boolean;   // a prompt is available
  isInstalled: boolean;     // running in standalone / already installed
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
Thin consumer of `AuthContext` — the single source of session truth. The provider
(`src/context/AuthContext.tsx`) owns the listener; this hook exposes it.
```ts
interface UseSupabaseAuth {
  user: User | null;
  session: Session | null;
  loading: boolean;         // initial session resolve in flight
  signOut: () => Promise<void>;
}
export function useSupabaseAuth(): UseSupabaseAuth;
```

## 4. `useOptimizedImage`
`src/hooks/useOptimizedImage.ts`
Builds a transformed ImageKit URL (real-time resize + auto format/quality).
```ts
interface ImageTransform {
  width?: number;
  height?: number;
  quality?: number;        // 1–100, default 80
  crop?: 'maintain_ratio' | 'force' | 'at_max';
}
export function useOptimizedImage(path: string, t?: ImageTransform): string;
```

## 5. `useInngestDispatch`
`src/hooks/useInngestDispatch.ts`
Dispatches a typed event to Inngest's ingest endpoint using the write-only key.
Fire-and-forget; failures are reported to Sentry, never thrown into the UI.
```ts
interface DispatchResult { ok: boolean; }
interface UseInngestDispatch {
  sending: boolean;
  send: (name: string, data: Record<string, unknown>) => Promise<DispatchResult>;
}
export function useInngestDispatch(): UseInngestDispatch;
```

## RotaFlow-specific hooks

### 6. `useOrg`
`src/hooks/useOrg.ts`
Consumer of `OrgContext` — the active tenant and the caller's role within it.
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
  // Additive beyond the original spec — used by OnboardingPage and anywhere
  // that needs to force a re-fetch (e.g. after an invite is accepted).
  createOrg: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}
export function useOrg(): UseOrg;
```

### 7. `usePermissions`
`src/hooks/usePermissions.ts`
Derives UI capabilities from the active role (client-side gating only; RLS is the
real enforcement).
```ts
interface Permissions {
  canBuildRota: boolean;      // owner | manager
  canApprove: boolean;        // leave/overtime/swaps
  canManageStaff: boolean;    // owner | manager
  canManageOrg: boolean;      // owner
  canManagePlatform: boolean; // super admin
}
export function usePermissions(): Permissions;
```

### 8. `useSyncQueue`
`src/hooks/useSyncQueue.ts`
Manages the IndexedDB offline outbox; replays queued writes when back online.
```ts
interface QueuedItem { id: string; kind: 'clock' | 'leave' | 'swap'; payload: unknown; queuedAt: string; }
interface UseSyncQueue {
  pending: QueuedItem[];
  enqueue: (kind: QueuedItem['kind'], payload: unknown) => Promise<void>;
  flush: () => Promise<{ synced: number; failed: number }>;
  syncing: boolean;
}
export function useSyncQueue(): UseSyncQueue;
```

### 9. `useGeolocation`
`src/hooks/useGeolocation.ts`
One-shot device position for GPS clock-in (with permission + accuracy handling).
```ts
interface GeoResult { latitude: number; longitude: number; accuracy: number; }
interface UseGeolocation {
  request: () => Promise<GeoResult | null>; // null if denied/unavailable
  status: 'idle' | 'prompting' | 'granted' | 'denied' | 'unavailable';
}
export function useGeolocation(): UseGeolocation;
```

## Conventions
- Every hook is fully typed with an explicit return interface.
- Hooks never read `import.meta.env` directly — they import from `@/lib/env`.
- Side-effectful hooks clean up their listeners in the `useEffect` return.
