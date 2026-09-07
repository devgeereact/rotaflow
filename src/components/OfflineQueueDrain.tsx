import { useSyncQueue } from '@/hooks/useSyncQueue';

/**
 * Drains the offline write outbox for the whole tenant shell.
 *
 * Until RF-06 the queue was only driven from the three screens that write to
 * it — clock-in, leave and swaps. That put replay behind navigation: a person
 * who clocked in offline and then opened the dashboard, or closed the app and
 * came back to it, had no mounted `useSyncQueue` to notice the network had
 * returned. Their clock-in sat in IndexedDB on one device, visible to nobody,
 * for as long as they stayed away from the clock screen.
 *
 * Mounting it once at `AppShell` makes replay a property of being signed in
 * rather than of which page happens to be open. The feature screens keep
 * their own `useSyncQueue` for `enqueue` and the failed-writes list; the
 * duplicate flush is harmless because `flushQueuedWrites` is guarded by the
 * hook's in-flight ref and, across tabs, by a Web Lock.
 *
 * It renders nothing. The visible half — "1 action didn't save" — belongs to
 * `FailedWritesNotice` on the screen the action was taken on, where the person
 * has the context to do something about it.
 */
export function OfflineQueueDrain(): null {
  useSyncQueue();
  return null;
}
