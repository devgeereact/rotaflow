import { describe, expect, it } from 'vitest';
import { orgProfileFields } from './orgPreferences';

/**
 * Where the organisation profile actually lives.
 *
 * 0023 gave `organisations` real columns for industry, country, timezone and
 * the two contact fields, and nothing ever wrote them: both the onboarding
 * wizard and the settings page kept putting those values in the `settings`
 * jsonb. The admin console reads the columns, found them empty for every
 * tenant, and invented an industry per row instead (BUG-026).
 *
 * The columns are canonical from this release, with `settings` as a fallback
 * for rows written before it. Both halves matter: preferring the column is
 * the fix, and still reading the jsonb is what stops existing tenants
 * appearing to lose the details they entered.
 */
describe('orgProfileFields', () => {
  const legacySettings = {
    industry: 'Hospitality',
    country: 'Ireland',
    timezone: 'Europe/Dublin',
    contact_email: 'legacy@example.com',
    phone: '0100 000 0000',
    org_type: 'charity',
  };

  it('reads the columns when they are set', () => {
    const fields = orgProfileFields(legacySettings, {
      industry: 'Domiciliary care',
      country: 'United Kingdom',
      timezone: 'Europe/London',
      contact_email: 'ops@example.com',
      contact_phone: '0161 000 0000',
    });

    expect(fields.industry).toBe('Domiciliary care');
    expect(fields.country).toBe('United Kingdom');
    expect(fields.timezone).toBe('Europe/London');
    expect(fields.contactEmail).toBe('ops@example.com');
    expect(fields.phone).toBe('0161 000 0000');
  });

  it('falls back to settings for a tenant written before the columns were used', () => {
    const fields = orgProfileFields(legacySettings, {
      industry: null,
      country: null,
      timezone: null,
      contact_email: null,
      contact_phone: null,
    });

    expect(fields.industry).toBe('Hospitality');
    expect(fields.country).toBe('Ireland');
    expect(fields.timezone).toBe('Europe/Dublin');
    expect(fields.contactEmail).toBe('legacy@example.com');
    expect(fields.phone).toBe('0100 000 0000');
  });

  it('treats a blank column as unset rather than as an answer', () => {
    const fields = orgProfileFields(legacySettings, {
      industry: '   ',
      country: '',
      timezone: null,
      contact_email: '',
      contact_phone: null,
    });

    expect(fields.industry).toBe('Hospitality');
    expect(fields.country).toBe('Ireland');
  });

  it('keeps the documented defaults when neither source has a value', () => {
    const fields = orgProfileFields(null, null);

    expect(fields.industry).toBe('');
    expect(fields.country).toBe('United Kingdom');
    expect(fields.timezone).toBe('Europe/London');
    expect(fields.workingWeek).toBe('mon-sun');
  });

  it('still reads the fields that have no column from settings', () => {
    const fields = orgProfileFields(legacySettings, {
      industry: 'Retail',
      country: 'United Kingdom',
      timezone: 'Europe/London',
      contact_email: null,
      contact_phone: null,
    });

    // org_type has no column on `organisations`, so the jsonb stays its home.
    expect(fields.orgType).toBe('charity');
  });
});
