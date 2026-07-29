import { Building2, ArrowLeft, ArrowRight, MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { StepCard } from '@/components/onboarding/StepCard';
import {
  COUNTRIES,
  INDUSTRIES,
  ORG_TYPES,
  TIMEZONES,
  WORKING_WEEKS,
} from '@/components/onboarding/constants';

export interface AboutValues {
  industry: string;
  orgType: string;
  country: string;
  timezone: string;
  workingWeek: string;
  locationName: string;
  locationAddress: string;
}

interface StepAboutProps {
  values: AboutValues;
  onChange: (patch: Partial<AboutValues>) => void;
  onBack: () => void;
  onContinue: () => void;
  submitting: boolean;
  error: string | null;
}

export function StepAbout({
  values,
  onChange,
  onBack,
  onContinue,
  submitting,
  error,
}: StepAboutProps): JSX.Element {
  return (
    <StepCard
      icon={Building2}
      title="About your organisation"
      subtitle="This helps us configure RotaFlow for your workspace."
      footer={
        <>
          <Button variant="ghost" onClick={onBack} disabled={submitting}>
            <ArrowLeft size={16} aria-hidden="true" className="mr-1.5" />
            Back
          </Button>
          <Button onClick={onContinue} disabled={submitting}>
            {submitting ? 'Saving…' : 'Continue'}
            {!submitting && (
              <ArrowRight size={16} aria-hidden="true" className="ml-1.5" />
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <Label htmlFor="about-industry">Industry</Label>
            <Select
              id="about-industry"
              value={values.industry}
              onChange={(e) => onChange({ industry: e.target.value })}
            >
              <option value="">Select your industry</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Helps us provide industry-specific templates and rules.
            </p>
          </div>

          <div>
            <Label htmlFor="about-type">Organisation type</Label>
            <Select
              id="about-type"
              value={values.orgType}
              onChange={(e) => onChange({ orgType: e.target.value })}
            >
              <option value="">Select a type</option>
              {ORG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              The type that best describes your organisation.
            </p>
          </div>

          <div>
            <Label htmlFor="about-country">Country / region</Label>
            <Select
              id="about-country"
              value={values.country}
              onChange={(e) => onChange({ country: e.target.value })}
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Sets your compliance and localisation defaults.
            </p>
          </div>

          <div>
            <Label htmlFor="about-timezone">Time zone</Label>
            <Select
              id="about-timezone"
              value={values.timezone}
              onChange={(e) => onChange({ timezone: e.target.value })}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Shift times are stored as instants and displayed in each location&rsquo;s
              zone.
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="about-week">Default working week</Label>
          <Select
            id="about-week"
            value={values.workingWeek}
            onChange={(e) => onChange({ workingWeek: e.target.value })}
          >
            {WORKING_WEEKS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            Used for rota planning and reports.
          </p>
        </div>

        <div>
          <div className="mb-3 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <MapPin
              size={18}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-primary"
            />
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              This will be your main operational location. You can add more later, and
              every rota is built against one.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="about-location-name">Primary location name</Label>
              <Input
                id="about-location-name"
                value={values.locationName}
                onChange={(e) => onChange({ locationName: e.target.value })}
                placeholder="e.g. Sunnyvale Care Centre"
              />
            </div>
            <div>
              <Label htmlFor="about-location-address">Address (optional)</Label>
              <Input
                id="about-location-address"
                value={values.locationAddress}
                onChange={(e) => onChange({ locationAddress: e.target.value })}
                placeholder="123 Care Street, Manchester"
              />
            </div>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-content-muted dark:text-content-muted-dark">
            <Plus size={12} aria-hidden="true" />
            Leave the name blank to skip — you can add locations from the Locations page.
          </p>
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </StepCard>
  );
}
