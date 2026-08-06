import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { getOrganisation, mergeOrgSettings } from '@/services/orgService';
import {
  DEFAULT_POLICIES,
  policiesToSettings,
  schedulingPolicies,
  type SchedulingPolicies,
} from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsSection } from '@/components/settings/SettingsSection';

interface NumericPolicy {
  key: keyof SchedulingPolicies;
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

const NUMERIC_POLICIES: NumericPolicy[] = [
  {
    key: 'overtimeThresholdHours',
    label: 'Overtime threshold',
    hint: 'Weekly hours after which time is treated as overtime on a timesheet.',
    unit: 'hours / week',
    min: 1,
    max: 80,
    step: 0.5,
  },
  {
    key: 'minRestHours',
    label: 'Minimum rest between shifts',
    hint: 'The gap a person should have between clocking out and their next shift.',
    unit: 'hours',
    min: 0,
    max: 24,
    step: 1,
  },
  {
    key: 'maxConsecutiveDays',
    label: 'Maximum consecutive days',
    hint: 'How many days in a row someone may be rostered.',
    unit: 'days',
    min: 1,
    max: 14,
    step: 1,
  },
  {
    key: 'roundingMinutes',
    label: 'Clock rounding',
    hint: 'Clock-in and clock-out times are rounded to this interval on timesheets.',
    unit: 'minutes',
    min: 1,
    max: 60,
    step: 1,
  },
  {
    key: 'publishLeadDays',
    label: 'Publish rotas in advance',
    hint: 'How far ahead a rota should be published for staff.',
    unit: 'days',
    min: 1,
    max: 90,
    step: 1,
  },
];

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
 * What ships here is the subset the product **already acts on or reports**:
 * the overtime threshold the timesheet split uses, clock rounding, minimum
 * rest, maximum consecutive days, break payment, and publish lead time.
 *
 * The honesty matters more than the count, so the screen states it directly:
 * these are defaults and reporting inputs, and nothing here blocks a rota from
 * being saved. An owner who sets "maximum 6 consecutive days" and assumes the
 * builder will refuse the seventh has been misled by a checkbox, that is the
 * failure this note exists to prevent.
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
          </div>
          <Toggle
            label="Breaks are paid"
            checked={policies.breaksArePaid}
            disabled={!canEdit}
            onChange={(next) => setPolicies((prev) => ({ ...prev, breaksArePaid: next }))}
          />
        </div>
      </SettingsSection>

      <Card className="bg-warning/5">
        <div className="flex gap-3">
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-warning"
            aria-hidden="true"
          />
          <div className="text-sm text-content-muted dark:text-content-muted-dark">
            <p className="font-medium text-content dark:text-content-dark">
              These are defaults, not enforcement
            </p>
            <p className="mt-1">
              RotaFlow uses these values when calculating timesheets and when suggesting
              shifts, and reports flag rotas that fall outside them. They do not currently
              block a rota from being saved, a manager can still roster a seventh
              consecutive day. Automatic validation while building a rota is planned
              separately.
            </p>
          </div>
        </div>
      </Card>

      {canEdit && (
        <div className="sticky bottom-0 -mx-1 flex justify-end border-t border-surface-border bg-background/90 px-1 py-4 backdrop-blur dark:border-surface-border-dark dark:bg-background-dark/90">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save policies'}
          </Button>
        </div>
      )}
    </div>
  );
}
