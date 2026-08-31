import { supabase } from '@/lib/supabase';

/**
 * Hourly rates, and what a rostered period costs (CAP-086, `0104`).
 *
 * ## Rates are a history, not a value
 *
 * Overwriting a rate rewrites the past: raise somebody in April and every
 * week they worked in March silently costs more, so last quarter's figure
 * changes after it was reported. Each row carries the date it takes effect.
 *
 * ## Money in integer pence
 *
 * The rest of the schema prices in pence and so does this. £12.34 as a float
 * is 12.339999999999999, and a labour cost is a sum of thousands of them.
 */

export interface PayRate {
  id: string;
  staffProfileId: string;
  hourlyRatePence: number;
  effectiveFrom: string;
  note: string | null;
}

export interface LabourCostRow {
  locationId: string | null;
  locationName: string | null;
  scheduledMinutes: number;
  costPence: number;
  /**
   * People rostered in the period with no rate on file.
   *
   * Surfaced rather than swallowed: a total that quietly prices somebody at
   * zero is worse than no total, because it looks like an answer.
   */
  unratedStaff: number;
}

/** Every rate ever set for one person, newest first. */
export async function listPayRates(
  orgId: string,
  staffProfileId: string,
): Promise<PayRate[]> {
  const { data, error } = await supabase
    .from('staff_pay_rates')
    .select('id, staff_profile_id, hourly_rate_pence, effective_from, note')
    .eq('org_id', orgId)
    .eq('staff_profile_id', staffProfileId)
    .order('effective_from', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    staffProfileId: row.staff_profile_id,
    hourlyRatePence: row.hourly_rate_pence,
    effectiveFrom: row.effective_from,
    note: row.note,
  }));
}

/**
 * Record a rate from a date.
 *
 * `upsert` on the unique `(staff_profile_id, effective_from)`: correcting a
 * rate somebody has just typed wrongly should replace that date's row, not
 * add a second one the cost query cannot choose between.
 */
export async function setPayRate(input: {
  orgId: string;
  staffProfileId: string;
  hourlyRatePence: number;
  effectiveFrom: string;
  note?: string | null;
  createdBy: string;
}): Promise<void> {
  const { error } = await supabase.from('staff_pay_rates').upsert(
    {
      org_id: input.orgId,
      staff_profile_id: input.staffProfileId,
      hourly_rate_pence: input.hourlyRatePence,
      effective_from: input.effectiveFrom,
      note: input.note ?? null,
      created_by: input.createdBy,
    },
    { onConflict: 'staff_profile_id,effective_from' },
  );
  if (error) throw error;
}

/**
 * What a period's roster costs, per location.
 *
 * The rate lookup and the multiplication happen in the database, and not only
 * for speed: a client computing this would have to READ every rate to
 * multiply by it, and most people are not allowed to. The function returns
 * money without handing out the rates it used.
 */
export async function getLabourCost(
  orgId: string,
  from: string,
  to: string,
  paidBreaks: boolean,
): Promise<LabourCostRow[]> {
  const { data, error } = await supabase.rpc('labour_cost', {
    p_org: orgId,
    p_from: from,
    p_to: to,
    p_paid_breaks: paidBreaks,
  });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    locationId: row.location_id,
    locationName: row.location_name,
    scheduledMinutes: Number(row.scheduled_minutes),
    costPence: Number(row.cost_pence),
    unratedStaff: row.unrated_staff,
  }));
}

/** Today's rate per person: managers see everyone, everybody else themselves. */
export async function getCurrentPayRates(orgId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('current_pay_rates', { p_org: orgId });
  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [row.staff_profile_id, row.hourly_rate_pence]),
  );
}
