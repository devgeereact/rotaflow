import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Calendar,
  Check,
  Clock,
  Globe,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
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

export interface LocationDraft {
  name: string;
  address: string;
}

export interface AboutValues {
  industry: string;
  orgType: string;
  country: string;
  timezone: string;
  workingWeek: string;
  locations: LocationDraft[];
}

interface StepAboutProps {
  values: AboutValues;
  onChange: (patch: Partial<AboutValues>) => void;
  onBack: () => void;
  onContinue: () => void;
  onSaveAndExit: () => void;
  submitting: boolean;
  error: string | null;
}

const EMPTY_LOCATION: LocationDraft = { name: '', address: '' };

export function StepAbout({
  values,
  onChange,
  onBack,
  onContinue,
  onSaveAndExit,
  submitting,
  error,
}: StepAboutProps): JSX.Element {
  // The primary location starts in edit mode when blank; every other location
  // starts in edit mode the moment it's added. `null` means "nothing being
  // edited right now" — every location with a name renders as a summary card.
  const [editingIndex, setEditingIndex] = useState<number | null>(
    values.locations[0]?.name ? null : 0,
  );

  const updateLocation = (index: number, patch: Partial<LocationDraft>): void => {
    onChange({
      locations: values.locations.map((loc, i) =>
        i === index ? { ...loc, ...patch } : loc,
      ),
    });
  };

  const addLocation = (): void => {
    onChange({ locations: [...values.locations, EMPTY_LOCATION] });
    setEditingIndex(values.locations.length);
  };

  const removeLocation = (index: number): void => {
    onChange({ locations: values.locations.filter((_, i) => i !== index) });
    setEditingIndex(null);
  };

  return (
    <StepCard
      icon={Building2}
      title="About your organisation"
      subtitle="This helps us configure RotaFlow for your workspace."
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" onClick={onBack} disabled={submitting}>
            <ArrowLeft size={16} aria-hidden="true" className="mr-1.5" />
            Back
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={onSaveAndExit} disabled={submitting}>
              Save and exit
            </Button>
            <Button
              className="bg-brand hover:bg-brand/90 dark:bg-brand"
              onClick={onContinue}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Continue'}
              {!submitting && (
                <ArrowRight size={16} aria-hidden="true" className="ml-1.5" />
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <Label htmlFor="about-industry">Industry</Label>
            <Select
              id="about-industry"
              icon={Briefcase}
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
              This helps us provide industry-specific templates and rules.
            </p>
          </div>

          <div>
            <Label htmlFor="about-type">Organisation type</Label>
            <Select
              id="about-type"
              icon={Building2}
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
              Select the type that best describes your organisation.
            </p>
          </div>

          <div>
            <Label htmlFor="about-country">Country / Region</Label>
            <Select
              id="about-country"
              icon={Globe}
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
              This will set your compliance and localisation.
            </p>
          </div>

          <div>
            <Label htmlFor="about-timezone">Time zone</Label>
            <Select
              id="about-timezone"
              icon={Clock}
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
              All times in RotaFlow will be shown in this time zone.
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="about-week">Default working week</Label>
          <Select
            id="about-week"
            icon={Calendar}
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
            This is used for rota planning and reports.
          </p>
        </div>

        <div>
          <Label>Primary location</Label>
          <div className="mb-3 flex flex-col gap-3 rounded-xl border border-brand/20 bg-brand-wash p-4 dark:bg-brand-deep/10 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <MapPin
                size={18}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-brand"
              />
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                This will be your main operational location. You can add more locations
                later.
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0 bg-brand hover:bg-brand/90 dark:bg-brand"
              onClick={addLocation}
              type="button"
            >
              <Plus size={16} aria-hidden="true" className="mr-1" />
              Add location
            </Button>
          </div>

          <div className="space-y-3">
            {values.locations.map((location, index) => {
              const isPrimary = index === 0;
              const editing = editingIndex === index;

              if (editing) {
                return (
                  <div
                    key={index}
                    className="rounded-xl border border-surface-border p-4 dark:border-surface-border-dark"
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor={`location-name-${index}`}>
                          {isPrimary ? 'Primary location name' : 'Location name'}
                        </Label>
                        <Input
                          id={`location-name-${index}`}
                          value={location.name}
                          onChange={(e) =>
                            updateLocation(index, { name: e.target.value })
                          }
                          placeholder="e.g. Sunnyvale Care Centre"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`location-address-${index}`}>
                          Address (optional)
                        </Label>
                        <Input
                          id={`location-address-${index}`}
                          value={location.address}
                          onChange={(e) =>
                            updateLocation(index, { address: e.target.value })
                          }
                          placeholder="123 Care Street, Manchester"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      {!isPrimary && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => removeLocation(index)}
                        >
                          <Trash2 size={14} aria-hidden="true" className="mr-1" />
                          Remove
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setEditingIndex(null)}>
                        <Check size={14} aria-hidden="true" className="mr-1" />
                        Done
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={index}
                  className="flex items-center justify-between gap-4 rounded-xl border border-surface-border p-4 dark:border-surface-border-dark"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-wash text-brand dark:bg-brand-deep/20 dark:text-brand-light">
                      <Building2 size={18} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-ink dark:text-content-dark">
                          {location.name}
                        </p>
                        {isPrimary && (
                          <span className="shrink-0 rounded-full bg-brand-wash px-2 py-0.5 text-xs font-medium text-brand dark:bg-brand-deep/20 dark:text-brand-light">
                            Primary
                          </span>
                        )}
                      </div>
                      {location.address && (
                        <p className="truncate text-sm text-content-muted dark:text-content-muted-dark">
                          {location.address}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      aria-label={`Edit ${location.name}`}
                      onClick={() => setEditingIndex(index)}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-surface-border text-content-muted hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    {!isPrimary && (
                      <button
                        type="button"
                        aria-label={`Remove ${location.name}`}
                        onClick={() => removeLocation(index)}
                        className="grid h-9 w-9 place-items-center rounded-lg border border-surface-border text-content-muted hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
            Leave the primary location blank to skip — you can add locations later from
            the Locations page.
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
