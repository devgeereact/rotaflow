/**
 * Kept so callers need not change. The API stamps an organisation's last activity itself on every signed-in
 * request it serves (users.last_seen_at and the audit trail), so the browser no longer reports it.
 */
export function touchOrgActivity(_orgId: string | null | undefined): void {
  // Nothing to send.
}
