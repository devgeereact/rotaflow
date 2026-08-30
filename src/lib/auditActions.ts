/**
 * Every action the system actually writes, in the tenant's language.
 *
 * This held ONE entry — `anonymize_staff_member` — while roughly forty
 * distinct actions were being recorded by triggers and RPCs across 0016,
 * 0017, 0019–0027, 0030, 0034, 0039–0040, 0052, 0061 and 0063. Everything
 * else rendered as its raw key, so an owner opening their audit trail read
 * `rota.amendment_discarded` and `org.support_access_allowed`. A compliance
 * surface nobody can read is not a compliance surface.
 *
 * Collected by grepping the migrations and Edge Functions for the action
 * strings they pass to `audit_write` and `log_audit_event`, not from
 * whatever a sample of production happened to contain. `platform_role.*`
 * and the platform-only rows are deliberately absent: a tenant never sees
 * them (`visibility = 'platform_only'`), so a label would be dead weight.
 *
 * Anything unrecognised still falls through to its raw key — better a code
 * than a wrong guess, and `formatAction` makes it legible.
 */
const ACTION_LABELS: Record<string, string> = {
  // Rota lifecycle (0061)
  'rota.published': 'Rota published',
  'rota.republished': 'Rota amendment published',
  'rota.superseded': 'Rota replaced by an amendment',
  'rota.unpublished': 'Rota unpublished',
  'rota.deleted': 'Rota deleted',
  'rota.amendment_started': 'Rota amendment started',
  'rota.amendment_discarded': 'Rota amendment discarded',
  'rota.shift_reassigned': 'Shift reassigned through a swap',

  // People and access (0016, 0006, 0052)
  'membership.added': 'Someone joined the organisation',
  'membership.changed': 'Someone’s role changed',
  'membership.removed': 'Someone was removed from the organisation',
  'invite.issued': 'Invitation sent',
  'invite.accepted': 'Invitation accepted',
  'invite.revoked': 'Invitation revoked',

  // The organisation itself (0016, 0017, 0063)
  'org.renamed': 'Organisation renamed',
  'org.settings_changed': 'Organisation settings changed',
  'org.plan_changed': 'Plan changed',
  'org.suspended': 'Organisation suspended',
  'org.reactivated': 'Organisation reactivated',
  'org.archived': 'Organisation archived',
  'org.deleted': 'Organisation deleted',
  'organisation.created_by_admin': 'Organisation created by RotaFlow support',

  // Support access (0019, 0028)
  'org.support_access_allowed': 'Support access allowed',
  'org.support_access_denied': 'Support access turned off',

  // Data protection (0011, 0020)
  anonymize_staff_member: 'Staff record anonymised',
  'gdpr.request_logged': 'Data request logged',
  'gdpr.request_extended': 'Data request deadline extended',
  'gdpr.export': 'Data exported',
  'gdpr.export_denied': 'Data export refused',

  // Exports (0016)
  'report.exported': 'Report exported',
  'timesheet.exported': 'Timesheets exported',
  'staff.exported': 'Staff records exported',

  // Day-to-day approvals (0039, 0040)
  'leave.reviewed': 'Leave request decided',
  'timesheet.amended': 'Timesheet corrected',

  // Billing (0023)
  'invoice.issued': 'Invoice issued',
  'invoice.paid': 'Invoice paid',
  'invoice.payment_failed': 'Payment failed',

  // Communication and integrations (0025, 0026)
  'announcement.created': 'Announcement created',
  'announcement.sent': 'Announcement sent',
  'integration.connected': 'Integration connected',

  // AI assistant (ai-rota-assistant)
  'ai_assistant.rota_suggestions_generated': 'AI suggested rota cover',
  'ai_assistant.announcement_drafted': 'AI drafted an announcement',
  'ai_assistant.announcement_rejected': 'AI announcement refused as ungrounded',
};

/**
 * A readable fallback for an action with no label yet, so a new event type
 * reads as "Rota shift swapped" rather than `rota.shift_swapped`.
 */
export function formatAuditAction(action: string): string {
  const label = ACTION_LABELS[action];
  if (label) return label;
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
