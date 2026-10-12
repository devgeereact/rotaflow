import { REGION_LABELS, type BankHolidayRegion } from '@/lib/bankHolidays';
import { LEAVE_YEAR_START_MONTHS } from '@/lib/leaveYear';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { getOrganisation, mergeOrgSettings } from '@/services/orgService';
import { Callout } from '@/components/ui/Callout';
import {
  DEFAULT_POLICIES,
  policiesToSettings,
  schedulingPolicies,
  type SchedulingPolicies,
} from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsSection } from '@/components/settings/SettingsSection';

type NumericPolicyKey =
  'overtimeThresholdHours' | 'minRestHours' | 'maxConsecutiveDays' | 'maxWeeklyHours';

interface NumericPolicy {
  key: NumericPolicyKey;
  label: string;
  hint: string;
  /** One plain sentence showing what the current value does in practice. */
  example: (value: number) => string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

/** 37.5 to "37.5", 11 to "11". No trailing ".0" in a sentence. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Minutes after midnight to "HH:MM", wrapping past midnight. */
function clock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

const NUMERIC_POLICIES: NumericPolicy[] = [
  {
    key: 'overtimeThresholdHours',
    label: 'Overtime threshold',
    hint: "Weekly hours after which worked time is highlighted on a staff member's own timesheet.",
    example: (v) =>
      `With ${n(v)} hours, someone who works ${n(v + 2.5)} hours in a week sees 2.5h highlighted over the threshold on their own timesheet.`,
    unit: 'hours / week',
    min: 1,
    max: 80,
    step: 0.5,
  },
  {
    key: 'minRestHours',
    label: 'Minimum rest between shifts',
    hint: 'The gap a person should have between one shift ending and the next starting. The rota warns when it is shorter.',
    example: (v) =>
      `With ${n(v)} hours rest, a shift ending at 23:00 means no start before ${clock(23 * 60 + v * 60)}.`,
    unit: 'hours',
    min: 0,
    max: 24,
    step: 1,
  },
  {
    key: 'maxConsecutiveDays',
    label: 'Maximum consecutive days',
    hint: 'How many days in a row someone may be rostered before the rota warns.',
    example: (v) =>
      `With ${n(v)} days, rostering someone for ${n(v + 1)} days in a row raises a warning on the rota.`,
    unit: 'days',
    min: 1,
    max: 14,
    step: 1,
  },
  {
    key: 'maxWeeklyHours',
    label: 'Maximum weekly hours',
    hint: 'The rota shows a weekly total in red past this. The legal limit is an average of 48 hours, and a worker can opt out of it in writing; raise this only for people who have.',
    example: (v) =>
      `With ${n(v)} hours, a person rostered for ${n(v + 2)} hours in one week shows their total in red on the rota.`,
    unit: 'hours / week',
    min: 1,
    max: 84,
    step: 1,
  },
];

const BANK_HOLIDAY_EXAMPLES: Record<BankHolidayRegion, string> = {
  'england-and-wales':
    'With England and Wales, Easter Monday is a bank holiday and 2 January is not.',
  scotland: 'With Scotland, 2 January is a bank holiday and Easter Monday is not.',
  'northern-ireland':
    "With Northern Ireland, St Patrick's Day on 17 March and 12 July are bank holidays too.",
};

/** A month's name from its number, 1 = January. 0 wraps to December. */
function monthName(value: number): string {
  return format(new Date(2026, value - 1, 1), 'MMMM');
}

/**
 * `/app/settings/policies`. Design/Settingspolicy.png, scoped honestly.
 *
 * ## Why this is six rules and not fifty-five
 *
 * The reference is a policy *engine*: roughly 55 policies across 10
 * categories, each with its own scope, status, version history, templates,
 * import/export, and live validation against the rota as it is built. That is
 * a project. Its own tables, its own evaluation pass in the rota builder, its
 * own conflict surface. Building the screen first would produce fifty toggles
 * that store a value nothing ever reads, which is indistinguishable from a
 * working feature until someone relies on it.
 *
 * What ships here is the subset the product **already acts on**: minimum
 * rest, maximum weekly hours and maximum consecutive days (rota warnings),
 * the overtime threshold (highlighted on a staff member's timesheet), break
 * payment, the holiday year, bank holidays and swap approval.
 *
 * Clock rounding, publish lead time and auto-declining clashing leave used to
 * be here too. Nothing read them, so a manager who changed one saw "saved" and
 * nothing else happened. They are gone from the screen; their stored values
 * are kept (`RETIRED_POLICY_KEYS`).
 *
 * The honesty matters more than the count, so the screen states it directly:
 * these warn, they do not block. An owner who sets "maximum 6 consecutive
 * days" and assumes the builder will refuse the seventh has been misled by a
 * checkbox, that is the failure the closing note exists to prevent.
 */
export function SettingsPoliciesPage(): JSX.Element {
  const { orgId, role, refresh } = useOrg();
  const { showError, showSuccess } = useToast();

  const [policies, setPolicies] = useState<SchedulingPolicies>(DEFAULT_POLICIES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canEdit = role === 'owner' || role === 'manager';

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const org = await getOrganisation(orgId);
        if (!active) return;
        setPolicies(schedulingPolicies(org.settings));
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'settings-policies:load' });
        showError('Could not load scheduling policies.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, showError]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setSaving(true);
    try {
      await mergeOrgSettings(orgId, policiesToSettings(policies));
      await refresh();
      showSuccess('Scheduling policies saved.');
    } catch (err) {
      reportError(err, { area: 'settings-policies:save' });
      showError('Could not save scheduling policies. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [orgId, policies, refresh, showError, showSuccess]);

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Loading…
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Working time"
        description="Defaults used when building rotas and calculating timesheets."
      >
        <div className="grid gap-6 md:grid-cols-2">
          {NUMERIC_POLICIES.map((policy) => (
            <div key={policy.key}>
              <Label htmlFor={`policy-${policy.key}`}>{policy.label}</Label>
              <div className="flex items-center gap-3">
                <Input
                  id={`policy-${policy.key}`}
                  type="number"
                  inputMode="decimal"
                  min={policy.min}
                  max={policy.max}
                  step={policy.step}
                  disabled={!canEdit}
                  value={String(policies[policy.key])}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const parsed = Number(e.target.value);
                    // Reject NaN rather than storing it, an empty field
                    // parses to NaN, which would serialise into the jsonb as
                    // null and read back as the default with no warning.
                    if (!Number.isFinite(parsed)) return;
                    setPolicies((prev) => ({ ...prev, [policy.key]: parsed }));
                  }}
                />
                <span className="shrink-0 text-sm text-content-muted dark:text-content-muted-dark">
                  {policy.unit}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-content-muted dark:text-content-muted-dark">
                {policy.hint}
              </p>
              <p className="mt-1 text-xs text-content dark:text-content-dark">
                {policy.example(policies[policy.key])}
              </p>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Breaks"
        description="How break time is treated when hours are totalled."
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-content dark:text-content-dark">
              Breaks are paid
            </p>
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              {policies.breaksArePaid
                ? 'Break time counts towards paid hours.'
                : 'Break time is deducted from paid hours.'}
            </p>
            <p className="mt-1 text-xs text-content dark:text-content-dark">
              {policies.breaksArePaid
                ? 'With paid breaks, a 9-hour shift with a 30-minute break pays 9 hours.'
                : 'With unpaid breaks, a 9-hour shift with a 30-minute break pays 8.5 hours.'}
            </p>
          </div>
          <Toggle
            label="Breaks are paid"
            checked={policies.breaksArePaid}
            disabled={!canEdit}
            onChange={(next) => setPolicies((prev) => ({ ...prev, breaksArePaid: next }))}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Holiday year"
        description="When the leave year runs, and what carries into the next one."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="policy-leave-year">Leave year starts in</Label>
            <Select
              id="policy-leave-year"
              value={String(policies.leaveYearStartMonth)}
              disabled={!canEdit}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setPolicies((prev) => ({
                  ...prev,
                  leaveYearStartMonth: Number(event.target.value),
                }))
              }
            >
              {LEAVE_YEAR_START_MONTHS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
              Balances are counted against this year, not the calendar one. April is the
              usual choice in the public sector.
            </p>
            <p className="mt-1 text-xs text-content dark:text-content-dark">
              {`With ${monthName(policies.leaveYearStartMonth)}, the year runs from 1 ${monthName(policies.leaveYearStartMonth)} to the end of ${monthName(policies.leaveYearStartMonth - 1)}.`}
            </p>
          </div>
          <div>
            <Label htmlFor="policy-carry-over">Days that can carry over</Label>
            <Input
              id="policy-carry-over"
              inputMode="numeric"
              value={String(policies.leaveCarryOverMaxDays)}
              disabled={!canEdit}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed) && parsed >= 0) {
                  setPolicies((prev) => ({ ...prev, leaveCarryOverMaxDays: parsed }));
                }
              }}
            />
            <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
              Zero is use it or lose it. Uncapped carry-over is how somebody accumulates
              months of untaken leave nobody has budgeted cover for.
            </p>
            <p className="mt-1 text-xs text-content dark:text-content-dark">
              {policies.leaveCarryOverMaxDays === 0
                ? 'With 0 days, any leave left at the end of the year is lost.'
                : `With ${n(policies.leaveCarryOverMaxDays)} days, someone with ${n(policies.leaveCarryOverMaxDays + 3)} days left at the end of the year carries ${n(policies.leaveCarryOverMaxDays)} into the next.`}
            </p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Bank holidays"
        description="Which nation's public holidays this organisation observes."
      >
        <div className="max-w-xs">
          <Label htmlFor="policy-bank-holidays">Bank holiday calendar</Label>
          <Select
            id="policy-bank-holidays"
            value={policies.bankHolidayRegion}
            disabled={!canEdit}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setPolicies((prev) => ({
                ...prev,
                bankHolidayRegion: event.target.value as BankHolidayRegion,
              }))
            }
          >
            {(Object.keys(REGION_LABELS) as BankHolidayRegion[]).map((region) => (
              <option key={region} value={region}>
                {REGION_LABELS[region]}
              </option>
            ))}
          </Select>
          <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
            Not cosmetic: Scotland has no Easter Monday and takes the first Monday in
            August rather than the last, and Northern Ireland adds two of its own. Leave
            requests name the bank holidays they cover.
          </p>
          <p className="mt-1 text-xs text-content dark:text-content-dark">
            {BANK_HOLIDAY_EXAMPLES[policies.bankHolidayRegion]}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Approvals"
        description="Who has to sign off before a request takes effect."
      >
        <div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-content dark:text-content-dark">
                Swap approval
              </p>
              <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                {policies.swapApprovalRequired
                  ? 'A manager must approve every swap, even once the colleague has accepted it.'
                  : 'Once a named colleague accepts a swap, the person who offered it can finalise it themselves — no manager needed. A manager can still step in on any swap at any stage.'}
              </p>
              <p className="mt-1 text-xs text-content dark:text-content-dark">
                {policies.swapApprovalRequired
                  ? 'With approval on, a swap Alex and Sam have both agreed still waits for a manager.'
                  : 'With approval off, a swap Alex and Sam have both agreed goes through straight away.'}
              </p>
            </div>
            <Toggle
              label="Swap approval required"
              checked={policies.swapApprovalRequired}
              disabled={!canEdit}
              onChange={(next) =>
                setPolicies((prev) => ({ ...prev, swapApprovalRequired: next }))
              }
            />
          </div>
        </div>
      </SettingsSection>

      <Callout tone="info" title="Staffing minimums live in Locations">
        How many people a site needs on shift is set per site, per day of the week, from
        that site's own Settings tab in{' '}
        <Link
          to="/app/locations"
          className="font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
        >
          Locations
        </Link>
        . A single org-wide number could not say Willow Court needs more cover on a
        Saturday than a Tuesday, which is exactly the kind of difference a staffing
        minimum exists to capture.
      </Callout>

      <Card className="bg-warning/5">
        <div className="flex gap-3">
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-warning"
            aria-hidden="true"
          />
          <div className="text-sm text-content-muted dark:text-content-muted-dark">
            <p className="font-medium text-content dark:text-content-dark">
              The working-time rules warn, they do not block
            </p>
            <p className="mt-1">
              Minimum rest, maximum weekly hours and maximum consecutive days raise
              warnings on the rota, and the overtime threshold highlights hours on a
              timesheet. None of them stops a rota being saved: a manager can still roster
              a seventh consecutive day, knowingly. Swap approval is different, turning it
              off genuinely removes the manager step.
            </p>
          </div>
        </div>
      </Card>

      {canEdit && (
        <div className="sticky bottom-0 -mx-1 flex justify-end border-t border-surface-border bg-background/90 px-1 py-4 backdrop-blur-sm dark:border-surface-border-dark dark:bg-background-dark/90">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save policies'}
          </Button>
        </div>
      )}
    </div>
  );
}
