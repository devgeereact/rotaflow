import { describe, expect, it } from 'vitest';
import {
  auditSeverityTone,
  formatAuditAction,
  formatAuditRecord,
  formatAuditSeverity,
} from '@/lib/auditActions';

describe('formatAuditAction', () => {
  it('names the actions the rota lifecycle actually writes', () => {
    // 0061 writes all four of these, and the audit screen used to render
    // every one of them as a raw key.
    expect(formatAuditAction('rota.published')).toBe('Rota published');
    expect(formatAuditAction('rota.republished')).toBe('Rota amendment published');
    expect(formatAuditAction('rota.amendment_discarded')).toBe(
      'Rota amendment discarded',
    );
    expect(formatAuditAction('rota.shift_reassigned')).toBe(
      'Shift reassigned through a swap',
    );
  });

  it('names the support-access events, which are the ones a tenant most needs', () => {
    expect(formatAuditAction('org.support_access_allowed')).toBe(
      'Support access allowed',
    );
    expect(formatAuditAction('org.support_access_denied')).toBe(
      'Support access turned off',
    );
  });

  it('keeps the one label that already existed', () => {
    expect(formatAuditAction('anonymize_staff_member')).toBe('Staff record anonymised');
  });

  it('falls back to something readable rather than a raw key', () => {
    // A new action added by a future migration should not read as
    // `rota.shift_swapped` on a compliance screen.
    expect(formatAuditAction('rota.shift_swapped')).toBe('Rota shift swapped');
    expect(formatAuditAction('something_entirely_new')).toBe('Something entirely new');
  });

  it('never returns an empty string, whatever it is handed', () => {
    expect(formatAuditAction('x')).toBe('X');
    expect(formatAuditAction('')).toBe('');
  });
});

describe('formatAuditRecord', () => {
  it('reads a record type as a heading would', () => {
    expect(formatAuditRecord('leave_request')).toBe('Leave request');
    expect(formatAuditRecord('organisation')).toBe('Organisation');
  });

  it('shows a dash for an entry about no particular record', () => {
    expect(formatAuditRecord(null)).toBe('-');
    expect(formatAuditRecord('')).toBe('-');
  });
});

describe('auditSeverityTone', () => {
  it('gives each stored severity its tone', () => {
    expect(auditSeverityTone('critical')).toBe('danger');
    expect(auditSeverityTone('warning')).toBe('warning');
    expect(auditSeverityTone('notice')).toBe('info');
    expect(auditSeverityTone('info')).toBe('neutral');
  });

  it('treats an unknown severity as routine rather than alarming', () => {
    expect(auditSeverityTone('something-new')).toBe('neutral');
  });

  it('capitalises the stored word for display', () => {
    expect(formatAuditSeverity('critical')).toBe('Critical');
  });
});
