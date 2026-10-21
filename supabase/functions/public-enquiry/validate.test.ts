import { describe, expect, it } from 'vitest';
import { SECTORS } from '@/lib/marketing';
import {
  ENQUIRY_SECTOR_OPTIONS,
  ENQUIRY_TEAM_SIZES,
  MESSAGE_MAX,
  MESSAGE_MIN,
} from '@/lib/enquiry';
import {
  ENQUIRY_SECTORS,
  LIMITS,
  TEAM_SIZES,
  boundedUserAgent,
  clientAddress,
  notificationText,
  validateEnquiry,
} from './validate';

/**
 * The public contact form's server-side checks. The handler half (CORS, the
 * origin refusal, Turnstile, the database call) needs Deno and is NOT covered
 * here; `supabase/tests/database/enquiries.test.sql` covers the table and the
 * rate limit.
 */

const valid = {
  name: 'Alex Morgan',
  workEmail: 'alex@sunnyvale.example',
  organisation: 'Sunnyvale Care Group',
  teamSize: '26-100',
  sector: 'Healthcare and care homes',
  message: 'We roster sixty carers across two homes.',
  wantsDemo: true,
  marketingConsent: false,
};

function headers(map: Record<string, string>): { get(name: string): string | null } {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}

describe('validateEnquiry', () => {
  it('accepts a complete enquiry and trims it', () => {
    const result = validateEnquiry({ ...valid, name: '  Alex Morgan  ' });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.enquiry.name).toBe('Alex Morgan');
    expect(result.enquiry.wantsDemo).toBe(true);
    expect(result.turnstileToken).toBeNull();
  });

  it('accepts the optional fields left out', () => {
    const result = validateEnquiry({
      name: 'Sam',
      workEmail: 'sam@example.co.uk',
      organisation: 'Acme',
      message: 'Just a question about pricing.',
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.enquiry.teamSize).toBeNull();
    expect(result.enquiry.sector).toBeNull();
    expect(result.enquiry.wantsDemo).toBe(false);
    expect(result.enquiry.marketingConsent).toBe(false);
  });

  it('treats a filled honeypot as spam, whatever else is wrong', () => {
    expect(validateEnquiry({ ...valid, website: 'http://spam.example' })).toEqual({
      kind: 'spam',
    });
    expect(validateEnquiry({ website: 'x' })).toEqual({ kind: 'spam' });
  });

  it('ignores an empty honeypot', () => {
    expect(validateEnquiry({ ...valid, website: '' }).kind).toBe('ok');
  });

  it('names the failing fields and never their values', () => {
    const result = validateEnquiry({
      ...valid,
      workEmail: 'not-an-address',
      message: 'short',
    });
    expect(result).toEqual({ kind: 'invalid', fields: ['workEmail', 'message'] });
    expect(JSON.stringify(result)).not.toContain('not-an-address');
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, 'text', 42, ['a']]) {
      expect(validateEnquiry(body)).toEqual({ kind: 'invalid', fields: ['body'] });
    }
  });

  it('enforces every length limit', () => {
    const tooLong = validateEnquiry({
      ...valid,
      name: 'a'.repeat(LIMITS.name + 1),
      organisation: 'o'.repeat(LIMITS.organisation + 1),
      message: 'm'.repeat(LIMITS.message + 1),
      workEmail: `${'e'.repeat(250)}@x.co`,
    });
    expect(tooLong).toEqual({
      kind: 'invalid',
      fields: ['name', 'workEmail', 'organisation', 'message'],
    });
  });

  it('refuses a value outside the enums', () => {
    expect(validateEnquiry({ ...valid, teamSize: '10000' })).toEqual({
      kind: 'invalid',
      fields: ['teamSize'],
    });
    expect(validateEnquiry({ ...valid, sector: 'Crypto' })).toEqual({
      kind: 'invalid',
      fields: ['sector'],
    });
  });

  it('only an explicit true is marketing consent', () => {
    expect(validateEnquiry({ ...valid, marketingConsent: 'true' }).kind).toBe('invalid');
    const given = validateEnquiry({ ...valid, marketingConsent: true });
    expect(given.kind === 'ok' && given.enquiry.marketingConsent).toBe(true);
  });

  it('refuses control characters in free text', () => {
    expect(validateEnquiry({ ...valid, name: 'Alex\u0000Morgan' })).toEqual({
      kind: 'invalid',
      fields: ['name'],
    });
    // A newline in a message is ordinary.
    expect(validateEnquiry({ ...valid, message: 'Line one.\nLine two.' }).kind).toBe(
      'ok',
    );
  });

  it('carries a Turnstile token through, and refuses an oversized one', () => {
    const ok = validateEnquiry({ ...valid, turnstileToken: 'token' });
    expect(ok.kind === 'ok' && ok.turnstileToken).toBe('token');
    expect(
      validateEnquiry({
        ...valid,
        turnstileToken: 't'.repeat(LIMITS.turnstileToken + 1),
      }),
    ).toEqual({ kind: 'invalid', fields: ['turnstileToken'] });
  });
});

describe('the form and the function agree', () => {
  it('offers the same team sizes', () => {
    expect([...ENQUIRY_TEAM_SIZES]).toEqual([...TEAM_SIZES]);
  });

  it('offers the marketing sectors plus Other, and the function accepts each', () => {
    expect([...ENQUIRY_SECTORS]).toEqual([...SECTORS.map((s) => s.name), 'Other']);
    expect(ENQUIRY_SECTOR_OPTIONS.map((o) => o.value)).toEqual([...ENQUIRY_SECTORS]);
  });

  it('uses the same message limits', () => {
    expect(MESSAGE_MIN).toBe(LIMITS.messageMin);
    expect(MESSAGE_MAX).toBe(LIMITS.message);
  });
});

describe('clientAddress', () => {
  it('prefers the address Cloudflare sets', () => {
    expect(
      clientAddress(
        headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }),
      ),
    ).toBe('203.0.113.9');
  });

  it('falls back to the first forwarded address', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe(
      '198.51.100.1',
    );
  });

  it('shares one subject when neither is present', () => {
    expect(clientAddress(headers({}))).toBe('unknown');
  });
});

describe('boundedUserAgent', () => {
  it('trims to the column limit and drops an empty value', () => {
    expect(boundedUserAgent('u'.repeat(500))).toHaveLength(LIMITS.userAgent);
    expect(boundedUserAgent('   ')).toBeNull();
    expect(boundedUserAgent(null)).toBeNull();
  });
});

describe('notificationText', () => {
  it('carries no free text the visitor typed', () => {
    const result = validateEnquiry(valid);
    if (result.kind !== 'ok') throw new Error('fixture should be valid');
    const { subject, text } = notificationText(
      result.enquiry,
      'https://rotaflow.space/admin/enquiries',
    );
    for (const typed of [
      valid.name,
      valid.workEmail,
      valid.organisation,
      valid.message,
    ]) {
      expect(subject).not.toContain(typed);
      expect(text).not.toContain(typed);
    }
    expect(subject).toBe('New website enquiry: demo requested');
    expect(text).toContain('https://rotaflow.space/admin/enquiries');
  });
});
