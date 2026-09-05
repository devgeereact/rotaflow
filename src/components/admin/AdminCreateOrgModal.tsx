import { useCallback, useEffect, useState } from 'react';
import { createOrganisationWithInvite } from '@/services/platformService';
import type { CreatedOrganisationInvite } from '@/services/platformService';
import { listPlans, type Plan } from '@/services/billingCheckoutService';
import { slugify } from '@/services/orgService';
import { isValidEmail } from '@/lib/email';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';

/**
 * Form for a platform admin to create an organisation on behalf of a
 * prospect who contacted sales directly — plan + optional negotiated price,
 * nothing else. Mirrors `TeamInviteManager`'s modal-then-copy-link pattern:
 * this component only handles the form and the RPC call; the caller
 * (`AdminOrganisationsPage`) owns showing the resulting invite link, same
 * split of responsibility as `TeamInviteManager` keeps within one file.
 */
export function AdminCreateOrgModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: CreatedOrganisationInvite, orgName: string, email: string) => void;
}): JSX.Element {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansFailed, setPlansFailed] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [plan, setPlan] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reopening must not show the previous attempt's values or errors.
  useEffect(() => {
    if (!open) return;
    setName('');
    setSlug('');
    setSlugTouched(false);
    setPriceInput('');
    setEmail('');
    setFormError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPlansFailed(false);
    void (async () => {
      try {
        const rows = await listPlans();
        if (!active) return;
        setPlans(rows);
        setPlan((current) => current || rows[0]?.code || '');
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:create-org:list-plans' });
        setPlansFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  const handleNameChange = useCallback(
    (value: string): void => {
      setName(value);
      if (!slugTouched) setSlug(slugify(value));
    },
    [slugTouched],
  );

  const handleSlugChange = useCallback((value: string): void => {
    setSlugTouched(true);
    setSlug(value);
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setFormError('Give the organisation a name.');
      return;
    }
    if (!trimmedSlug) {
      setFormError('Give the organisation a slug.');
      return;
    }
    if (!plan) {
      setFormError('Choose a plan.');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setFormError('That does not look like a valid email address.');
      return;
    }

    let pricePence: number | null = null;
    if (priceInput.trim() !== '') {
      const pounds = Number(priceInput);
      if (!Number.isFinite(pounds) || pounds < 0) {
        setFormError('The negotiated price must be a positive number, in pounds.');
        return;
      }
      if (pounds > 1_000_000) {
        setFormError(
          "The negotiated price seems too high — check it's in pounds, not pence.",
        );
        return;
      }
      pricePence = Math.round(pounds * 100);
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const result = await createOrganisationWithInvite({
        name: trimmedName,
        slug: trimmedSlug,
        plan: plan as 'starter' | 'professional' | 'business' | 'enterprise',
        ownerEmail: trimmedEmail,
        pricePence,
      });
      onCreated(result, trimmedName, trimmedEmail);
    } catch (err) {
      reportError(err, { area: 'admin:create-org:submit' });
      // The database raises specific messages (unknown plan, insufficient
      // role) that are more useful than a generic one — except a duplicate
      // slug, which surfaces as a raw Postgres unique-violation
      // (code 23505) rather than a readable message.
      const conflict = (err as { code?: string } | null)?.code === '23505';
      const message = conflict
        ? 'That slug is already taken. Try a different one.'
        : err instanceof Error && err.message
          ? err.message
          : 'Could not create that organisation.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }, [name, slug, plan, priceInput, email, onCreated]);

  return (
    <Modal open={open} onClose={onClose} title="Create organisation">
      <div className="space-y-4">
        <div>
          <Label htmlFor="create-org-name">Organisation name</Label>
          <Input
            id="create-org-name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Acme Facilities Ltd"
          />
        </div>

        <div>
          <Label htmlFor="create-org-slug">Slug</Label>
          <Input
            id="create-org-slug"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="acme-facilities"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            Auto-filled from the name. Edit it if the prospect wants something specific.
          </p>
        </div>

        <div>
          <Label htmlFor="create-org-plan">Plan</Label>
          {plansFailed ? (
            <p className="text-sm text-danger-ink dark:text-danger-ink-dark">
              Could not load the plan list.
            </p>
          ) : (
            <Select
              id="create-org-plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            >
              {plans.length === 0 && <option value="">Loading…</option>}
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} — £{(p.monthly_price_pence / 100).toFixed(2)}/mo
                </option>
              ))}
            </Select>
          )}
        </div>

        <div>
          <Label htmlFor="create-org-price">Negotiated price (optional)</Label>
          <Input
            id="create-org-price"
            type="number"
            min="0"
            step="0.01"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="Leave blank to use the plan's list price"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            In pounds. Overrides the plan's list price for this organisation only.
          </p>
        </div>

        <div>
          <Label htmlFor="create-org-email">Contact's email</Label>
          <Input
            id="create-org-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@theircompany.com"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            They'll join as the organisation's owner once they accept the invite you'll
            get a link for next.
          </p>
        </div>

        {formError && (
          <p className="text-sm text-danger-ink dark:text-danger-ink-dark" role="alert">
            {formError}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || plansFailed}
          >
            {submitting ? 'Creating…' : 'Create organisation'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
