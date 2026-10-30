import { api, orgPath, seg } from '@/lib/api';

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
  const r = await api.get<{
    pay_rates: {
      id: string;
      hourly_rate_pence: number | string;
      effective_from: string;
    }[];
  }>(orgPath(orgId, `/staff/${seg(staffProfileId)}/pay-rates`));
  return r.pay_rates.map((row) => ({
    id: row.id,
    staffProfileId,
    hourlyRatePence: Number(row.hourly_rate_pence),
    effectiveFrom: row.effective_from,
    // The API keeps no note on a rate; the history itself (dates and amounts) is the record.
    note: null,
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
  // Rates are a history: a second rate on the same start date is refused (409 rate_exists), not overwritten.
  await api.post(orgPath(input.orgId, `/staff/${seg(input.staffProfileId)}/pay-rates`), {
    hourly_rate_pence: input.hourlyRatePence,
    effective_from: input.effectiveFrom,
  });
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
  const r = await api.get<{
    rows: {
      location_id: string | null;
      location_name: string | null;
      scheduled_minutes: number;
      cost_pence: number;
      unrated_staff: number;
    }[];
  }>(orgPath(orgId, '/labour-cost'), { from, to, paid_breaks: paidBreaks ? 1 : 0 });
  return r.rows.map((row) => ({
    locationId: row.location_id,
    locationName: row.location_name,
    scheduledMinutes: Number(row.scheduled_minutes),
    costPence: Number(row.cost_pence),
    unratedStaff: row.unrated_staff,
  }));
}

/** Today's rate per person: managers see everyone, everybody else themselves. */
export async function getCurrentPayRates(orgId: string): Promise<Map<string, number>> {
  const r = await api.get<{
    rates: { staff_profile_id: string; hourly_rate_pence: number }[];
  }>(orgPath(orgId, '/pay-rates/current'));
  return new Map(r.rates.map((row) => [row.staff_profile_id, row.hourly_rate_pence]));
}
