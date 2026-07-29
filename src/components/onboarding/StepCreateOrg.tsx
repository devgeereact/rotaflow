import { useCallback, useEffect, useState } from 'react';
import { Building2, ArrowRight, Check, Info, Loader2 } from 'lucide-react';
import { isSlugAvailable, slugify } from '@/services/orgService';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { StepCard } from '@/components/onboarding/StepCard';
import { INDUSTRIES, ORG_SIZES } from '@/components/onboarding/constants';

export interface CreateOrgValues {
  name: string;
  slug: string;
  industry: string;
  size: string;
}

interface StepCreateOrgProps {
  values: CreateOrgValues;
  onChange: (patch: Partial<CreateOrgValues>) => void;
  onContinue: () => void;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
}

type SlugState = 'idle' | 'checking' | 'available' | 'taken' | 'unknown';

export function StepCreateOrg({
  values,
  onChange,
  onContinue,
  onCancel,
  submitting,
  error,
}: StepCreateOrgProps): JSX.Element {
  const [slugState, setSlugState] = useState<SlugState>('idle');
  // True once the user edits the slug directly, after which it stops tracking
  // the name — otherwise typing a name would silently overwrite their choice.
  const [slugTouched, setSlugTouched] = useState(false);

  const handleName = useCallback(
    (name: string): void => {
      onChange(slugTouched ? { name } : { name, slug: slugify(name) });
    },
    [onChange, slugTouched],
  );

  useEffect(() => {
    const slug = values.slug.trim();
    if (slug.length < 3) {
      setSlugState('idle');
      return;
    }
    setSlugState('checking');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          setSlugState((await isSlugAvailable(slug)) ? 'available' : 'taken');
        } catch (err) {
          // The check needs migration 0007; without it, don't block the user —
          // the unique constraint still rejects a genuine clash on submit.
          reportError(err, { area: 'onboarding:slug-check' });
          setSlugState('unknown');
        }
      })();
    }, 400);
    return () => clearTimeout(timer);
  }, [values.slug]);

  const canContinue =
    values.name.trim().length > 0 &&
    values.slug.trim().length >= 3 &&
    slugState !== 'taken';

  return (
    <StepCard
      icon={Building2}
      title="Create your organisation"
      subtitle="This will be your workspace in RotaFlow."
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onContinue} disabled={!canContinue || submitting}>
            {submitting ? 'Creating…' : 'Continue'}
            {!submitting && (
              <ArrowRight size={16} aria-hidden="true" className="ml-1.5" />
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div>
          <Label htmlFor="org-name">Organisation name</Label>
          <Input
            id="org-name"
            value={values.name}
            onChange={(e) => handleName(e.target.value)}
            placeholder="e.g. Sunnyvale Care Group"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            This is the name of your company or organisation.
          </p>
        </div>

        <div>
          <Label htmlFor="org-slug">Organisation identifier</Label>
          <Input
            id="org-slug"
            value={values.slug}
            onChange={(e) => {
              setSlugTouched(true);
              onChange({ slug: slugify(e.target.value) });
            }}
            placeholder="your-org-name"
            aria-describedby="org-slug-status"
          />
          <p
            id="org-slug-status"
            role="status"
            className="mt-1 flex items-center gap-1.5 text-xs"
          >
            {slugState === 'checking' && (
              <>
                <Loader2
                  size={13}
                  aria-hidden="true"
                  className="animate-spin text-content-muted"
                />
                <span className="text-content-muted dark:text-content-muted-dark">
                  Checking availability…
                </span>
              </>
            )}
            {slugState === 'available' && (
              <>
                <Check size={13} aria-hidden="true" className="text-success" />
                <span className="text-success">
                  &ldquo;{values.slug}&rdquo; is available
                </span>
              </>
            )}
            {slugState === 'taken' && (
              <span className="text-danger">
                &ldquo;{values.slug}&rdquo; is already taken — try another
              </span>
            )}
            {(slugState === 'idle' || slugState === 'unknown') && (
              <span className="text-content-muted dark:text-content-muted-dark">
                A short, unique identifier for your organisation. Lower case, no spaces.
              </span>
            )}
          </p>
        </div>

        <div>
          <Label htmlFor="org-industry">Primary industry</Label>
          <Select
            id="org-industry"
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
        </div>

        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-content dark:text-content-dark">
            Organisation size
          </legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ORG_SIZES.map((option) => {
              const selected = values.size === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors',
                    selected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-surface-border hover:border-primary/40 dark:border-surface-border-dark',
                  )}
                >
                  <input
                    type="radio"
                    name="org-size"
                    value={option.value}
                    checked={selected}
                    onChange={() => onChange({ size: option.value })}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-medium text-content dark:text-content-dark">
                      {option.label}
                    </span>
                    <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                      {option.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            You can change these details and add more information later from organisation
            settings.
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
