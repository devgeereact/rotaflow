// _shared/smtp.ts. RotaFlow
//
// One SMTP resolution, shared by send-notification and send-invite, for the
// same reason _shared/stripe.ts exists: two copies of "which mailbox does this
// organisation send from" drift, and the one that drifts is the one nobody is
// looking at.
//
// The order is deliberate and is the product decision, not an implementation
// detail: an organisation's OWN mailbox first, the platform's only as a
// fallback, and nothing at all rather than a misleading sender. Mail that
// reaches a care home's staff should come from that care home — see
// 0010_org_smtp_settings.sql.
//
// `test-smtp` deliberately does NOT use this. It exists to prove an
// organisation's own credentials work, so falling back to the platform's would
// make a broken config look healthy.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface SmtpTransportConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** RFC 5322 From header, display name included when the org set one. */
  from: string;
}

/**
 * Placeholder values ship in `.env.example`; sending against them would fail
 * loudly at connect time and look like a broken mail server rather than an
 * unconfigured one.
 */
export function globalSmtpIsConfigured(): boolean {
  const host = Deno.env.get('SMTP_HOST');
  const pass = Deno.env.get('SMTP_PASS');
  return (
    Boolean(host) &&
    host !== 'smtp.yourhost.com' &&
    Boolean(pass) &&
    pass !== 'your-smtp-password'
  );
}

/**
 * The mailbox this organisation sends from, or null if neither it nor the
 * platform has one configured.
 *
 * Reads `smtp_pass`, so it requires a service-role client. That column is
 * excluded from the `authenticated` SELECT grant entirely (0010), which is what
 * keeps it out of the browser regardless of policy changes.
 */
export async function resolveSmtpConfig(
  supabase: SupabaseClient,
  orgId: string,
): Promise<SmtpTransportConfig | null> {
  const { data: orgSmtp, error } = await supabase
    .from('org_smtp_settings')
    .select('smtp_host, smtp_port, smtp_user, smtp_pass, from_email, from_name')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    // A transient lookup failure must not look identical to "this org has no
    // SMTP configured" — that silently produces the shared-sender outcome
    // per-org SMTP exists to avoid. Never log the row: it carries smtp_pass.
    console.error('resolveSmtpConfig: org SMTP lookup failed', error.message);
  }

  if (orgSmtp) {
    return {
      host: orgSmtp.smtp_host as string,
      port: orgSmtp.smtp_port as number,
      user: orgSmtp.smtp_user as string,
      pass: orgSmtp.smtp_pass as string,
      from: orgSmtp.from_name
        ? `"${orgSmtp.from_name}" <${orgSmtp.from_email}>`
        : (orgSmtp.from_email as string),
    };
  }

  if (!globalSmtpIsConfigured()) return null;
  return {
    host: Deno.env.get('SMTP_HOST')!,
    port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
    user: Deno.env.get('SMTP_USER')!,
    pass: Deno.env.get('SMTP_PASS')!,
    from: Deno.env.get('SMTP_FROM')!,
  };
}

/**
 * A nodemailer transport for one resolved config.
 *
 * Port 465 is implicit TLS; every other port (587 included) starts plain and
 * upgrades via STARTTLS, so `secure: true` there breaks the handshake. The
 * timeouts exist because a bad owner-provided host must fail fast rather than
 * hang the whole function.
 */
export async function createSmtpTransport(config: SmtpTransportConfig) {
  const { default: nodemailer } = await import('npm:nodemailer@6');
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}
