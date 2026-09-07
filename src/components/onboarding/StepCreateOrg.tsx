import { useCallback, useEffect, useState } from 'react';
import {
  Briefcase,
  Building2,
  ArrowRight,
  Check,
  Info,
  Loader2,
  Users,
} from 'lucide-react';
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
  /**
   * Set once the organisation exists, i.e. whenever this step is re-entered
   * via Back. The slug check must then ignore that org, or the caller's own
   * identifier reports as taken and Continue can never re-enable.
   */
  existingOrgId?: string | null;
}

type SlugState = 'idle' | 'checking' | 'available' | 'taken' | 'unknown';

/**
 * The subdomain suffix shown alongside the slug field, e.g.
 * "your-org-name**.rotaflow.space**" (docs/design/Organisation-Onboarding.png
 * shows ".rotaflow.app", not usable: docs/DEPLOYMENT.md already flags that
 * domain as somebody else's live, unrelated product, the exact mistake
 * `VITE_APP_URL` shipped with until 2026-07-29). `rotaflow.space` is the
 * domain this app actually owns, as of 2026-08-29; no per-org subdomain
 * routing exists yet, but showing the real domain here is a forward-looking
 * URL pattern, not a false claim about a domain the project doesn't control.
 */
const SLUG_DOMAIN = 'rotaflow.space';

export function StepCreateOrg({
  values,
  onChange,
  onContinue,
  onCancel,
  submitting,
  error,
  existingOrgId,
}: StepCreateOrgProps): JSX.Element {
  const [slugState, setSlugState] = useState<SlugState>('idle');
  // True once the user edits the slug directly, after which it stops tracking
  // the name. Otherwise typing a name would silently overwrite their choice.
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
          setSlugState(
            (await isSlugAvailable(slug, existingOrgId)) ? 'available' : 'taken',
          );
        } catch (err) {
          // The check needs migration 0007; without it, don't block the user, // the unique constraint still rejects a genuine clash on submit.
          reportError(err, { area: 'onboarding:slug-check' });
          setSlugState('unknown');
        }
      })();
    }, 400);
    return () => clearTimeout(timer);
  }, [values.slug, existingOrgId]);

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
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            className="bg-brand hover:bg-brand/90 dark:bg-brand"
            onClick={onContinue}
            disabled={!canContinue || submitting}
          >
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
            icon={Building2}
            value={values.name}
            onChange={(e) => handleName(e.target.value)}
            placeholder="e.g. Sunnyvale Care Group"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            This is the name of your company or organisation.
          </p>
        </div>

        <div>
          <Label htmlFor="org-slug">Subdomain</Label>
          <div className="flex">
            <Input
              id="org-slug"
              className="flex-1 rounded-r-none"
              value={values.slug}
              onChange={(e) => {
                setSlugTouched(true);
                onChange({ slug: slugify(e.target.value) });
              }}
              placeholder="your-org-name"
              aria-describedby="org-slug-status"
            />
            <span className="flex items-center whitespace-nowrap rounded-r-xl border border-l-0 border-surface-border bg-surface-subtle px-3 text-sm text-content-muted dark:border-surface-border-dark dark:bg-surface-subtle-dark dark:text-content-muted-dark">
              .{SLUG_DOMAIN}
            </span>
          </div>
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
                  {values.slug}.{SLUG_DOMAIN} is available
                </span>
              </>
            )}
            {slugState === 'taken' && (
              <span className="text-danger">
                &ldquo;{values.slug}&rdquo; is already taken. Try another
              </span>
            )}
            {(slugState === 'idle' || slugState === 'unknown') && (
              <span className="text-content-muted dark:text-content-muted-dark">
                This will be your unique organisation URL.
              </span>
            )}
          </p>
        </div>

        <div>
          <Label htmlFor="org-industry">Primary industry</Label>
          <Select
            id="org-industry"
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
        </div>

        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-ink dark:text-content-dark">
            Organisation size
          </legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ORG_SIZES.map((option) => {
              const selected = values.size === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-4 pt-6 text-center transition-colors',
                    selected
                      ? 'border-brand bg-brand-wash dark:bg-brand-deep/10'
                      : 'border-surface-border hover:border-brand/40 dark:border-surface-border-dark',
                  )}
                >
                  <input
                    type="radio"
                    name="org-size"
                    value={option.value}
                    checked={selected}
                    onChange={() => onChange({ size: option.value })}
                    className="absolute left-3 top-3 h-4 w-4 accent-brand"
                  />
                  <Users
                    size={22}
                    aria-hidden="true"
                    className={selected ? 'text-brand' : 'text-content-muted'}
                  />
                  <span className="block text-sm font-medium text-ink dark:text-content-dark">
                    {option.label}
                  </span>
                  {/* Not a flat `text-content-muted`: selected cards sit on
                      `bg-brand-wash`, where the muted token reads at 4.0:1,
                      under the 4.5:1 minimum. Full ink there instead. */}
                  <span
                    className={cn(
                      'block text-xs',
                      selected
                        ? 'text-content dark:text-content-dark'
                        : 'text-content-muted dark:text-content-muted-dark',
                    )}
                  >
                    {option.hint}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex gap-3 rounded-xl border border-brand/20 bg-brand-wash p-4 dark:bg-brand-deep/10">
          <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
          {/* Not `text-content-muted`: on this box's `bg-brand-wash` it reads
              at 4.0:1, under the 4.5:1 minimum. */}
          <p className="text-sm text-content dark:text-content-dark">
            You can change these details and add more information later from organisation
            settings.
          </p>
        </div>

        {error && (
          <p className="text-sm text-danger-ink dark:text-danger-ink-dark" role="alert">
            {error}
          </p>
        )}
      </div>
    </StepCard>
  );
}
