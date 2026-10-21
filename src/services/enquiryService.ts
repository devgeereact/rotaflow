import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import {
  isEnquiryStatus,
  type EnquiryFields,
  type EnquiryRecord,
  type EnquiryStatus,
} from '@/lib/enquiry';

/**
 * Website enquiries: the public form's one write, and the console's reads.
 *
 * The write goes to the `public-enquiry` Edge Function, never to the table:
 * `anon` holds no privilege on `enquiries` (0155). The reads and the status
 * change are ordinary queries, and `enquiries_select`/`enquiries_update` admit
 * operational platform roles only.
 */

export type SubmitOutcome =
  | { ok: true }
  /** Too many from this address, or from everybody, in the last hour. */
  | { ok: false; reason: 'rate_limited' }
  /** The server refused a field the browser let through. */
  | { ok: false; reason: 'invalid' }
  /** Anything else: offline, unconfigured, a 5xx, a bot check that failed. */
  | { ok: false; reason: 'unavailable' };

/**
 * Posts one enquiry. Resolves `{ ok: true }` only on a 201 whose body says
 * so, which is the only state the page may call a success.
 *
 * `fetch` rather than `functions.invoke` because the status code is the
 * contract here and the SDK folds every non-2xx into one generic error. The
 * anon key travels as `apikey` because the platform gateway asks for it; it
 * grants nothing on the table.
 */
export async function submitEnquiry(
  fields: EnquiryFields,
  turnstileToken: string | null,
): Promise<SubmitOutcome> {
  if (!env.supabaseUrl || !env.supabaseAnonKey)
    return { ok: false, reason: 'unavailable' };

  const body = {
    name: fields.name.trim(),
    workEmail: fields.workEmail.trim(),
    organisation: fields.organisation.trim(),
    teamSize: fields.teamSize || null,
    sector: fields.sector || null,
    message: fields.message.trim(),
    wantsDemo: fields.wantsDemo,
    marketingConsent: fields.marketingConsent,
    website: fields.website,
    ...(turnstileToken ? { turnstileToken } : {}),
  };

  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/functions/v1/public-enquiry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (response.status === 429) return { ok: false, reason: 'rate_limited' };
  if (response.status === 201) {
    try {
      const payload = (await response.json()) as { ok?: unknown };
      if (payload.ok === true) return { ok: true };
    } catch {
      // A 201 without the agreed body is not a success the page can promise.
    }
    return { ok: false, reason: 'unavailable' };
  }
  if (response.status === 400) {
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (payload.error === 'invalid') return { ok: false, reason: 'invalid' };
    } catch {
      // Fall through.
    }
  }
  return { ok: false, reason: 'unavailable' };
}

interface EnquiryRow {
  id: string;
  name: string;
  work_email: string;
  organisation: string;
  team_size: string | null;
  sector: string | null;
  message: string;
  wants_demo: boolean;
  marketing_consent: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Named columns, never `*`: `ip_hash` and `user_agent` are withheld from
 * `authenticated` by column grant, and `select *` would be refused outright.
 */
const COLUMNS =
  'id, name, work_email, organisation, team_size, sector, message, wants_demo, marketing_consent, status, created_at, updated_at';

function toRecord(row: EnquiryRow): EnquiryRecord {
  return {
    id: row.id,
    name: row.name,
    workEmail: row.work_email,
    organisation: row.organisation,
    teamSize: row.team_size,
    sector: row.sector,
    message: row.message,
    wantsDemo: row.wants_demo,
    marketingConsent: row.marketing_consent,
    // An unknown value would be a schema the client does not know yet; show it
    // as new rather than hide the row.
    status: isEnquiryStatus(row.status) ? row.status : 'new',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The newest 500. Enough for a small inbox; the retention job keeps it small. */
export async function listEnquiries(): Promise<EnquiryRecord[]> {
  const { data, error } = await supabase
    .from('enquiries')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as EnquiryRow[]).map(toRecord);
}

/**
 * Moves an enquiry on. Checks that a row actually changed: RLS filters a
 * refused update to zero rows rather than raising, and a screen that said
 * "Saved" over that would be lying.
 */
export async function setEnquiryStatus(id: string, status: EnquiryStatus): Promise<void> {
  const { data, error } = await supabase
    .from('enquiries')
    .update({ status })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('The enquiry could not be updated. You may not have access to it.');
  }
}
