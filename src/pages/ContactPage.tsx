import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2, Mail, MessageSquare, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import {
  TurnstileWidget,
  type TurnstileHandle,
} from '@/components/marketing/TurnstileWidget';
import { CONTACT_EMAIL, PRIMARY_CTA } from '@/lib/marketing';
import { env } from '@/lib/env';
import {
  EMPTY_ENQUIRY,
  ENQUIRY_SECTOR_OPTIONS,
  ENQUIRY_TEAM_SIZES,
  validateEnquiryFields,
  wantsDemoFromSearch,
  type EnquiryErrors,
  type EnquiryFields,
} from '@/lib/enquiry';
import { submitEnquiry, type SubmitOutcome } from '@/services/enquiryService';
import { cn } from '@/lib/utils';

/**
 * `/contact`.
 *
 * ## What happens when somebody presses Send
 *
 * The form posts to the `public-enquiry` Edge Function, which validates it
 * again, applies a per-address rate limit and stores it in `enquiries` (0155)
 * for the platform console's Enquiries inbox. Until October 2026 it opened a
 * `mailto:` link instead, which reached nobody on a device with no mail client.
 *
 * The success message appears only after the server answered 201. Anything
 * else, including a network failure, shows the support address, so a visitor
 * is never told a message arrived when it did not.
 *
 * `?demo=1` (every "Book a demo" link) starts with the demo box ticked.
 */

type FailureReason = Extract<SubmitOutcome, { ok: false }>['reason'];

type Phase =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; reason: FailureReason };

/** The order fields appear in, so a failed submit focuses the first invalid one. */
const FIELD_ORDER = ['name', 'workEmail', 'organisation', 'message'] as const;
type CheckedField = (typeof FIELD_ORDER)[number];

const FAILURE_TEXT: Record<FailureReason, string> = {
  rate_limited: 'We have had a lot of messages from your connection in the last hour.',
  invalid: 'Something in the form was not accepted.',
  unavailable: 'Your message did not reach us.',
};

const textareaClass = cn(
  'w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-hidden',
  'placeholder:text-content-muted focus-visible:ring-2 focus-visible:ring-primary',
  'dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark',
);

export function ContactPage(): JSX.Element {
  const location = useLocation();
  const [fields, setFields] = useState<EnquiryFields>(() => ({
    ...EMPTY_ENQUIRY,
    wantsDemo: wantsDemoFromSearch(location.search),
  }));
  const [errors, setErrors] = useState<EnquiryErrors>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const siteKey = env.turnstileSiteKey;

  const refs = {
    name: useRef<HTMLInputElement>(null),
    workEmail: useRef<HTMLInputElement>(null),
    organisation: useRef<HTMLInputElement>(null),
    message: useRef<HTMLTextAreaElement>(null),
  };

  const set = <K extends keyof EnquiryFields>(key: K, value: EnquiryFields[K]): void => {
    setFields((prev) => ({ ...prev, [key]: value }));
    // Clear the field's own error as soon as it is edited, so the fix reads
    // as registered.
    setErrors((prev) =>
      key in prev && prev[key as CheckedField] ? { ...prev, [key]: undefined } : prev,
    );
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (phase.kind === 'sending') return;

    const found = validateEnquiryFields(fields);
    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((key) => found[key] !== undefined);
    if (firstInvalid) {
      // Chosen from the validation result, not the DOM: `setErrors` has not
      // rendered yet, so nothing carries `aria-invalid` at this point.
      refs[firstInvalid].current?.focus();
      return;
    }
    if (siteKey && !turnstileToken) {
      setPhase({ kind: 'failed', reason: 'unavailable' });
      return;
    }

    setPhase({ kind: 'sending' });
    const outcome = await submitEnquiry(fields, siteKey ? turnstileToken : null);
    if (outcome.ok) {
      setPhase({ kind: 'sent' });
      return;
    }
    // A Turnstile token is single use, spent or not.
    if (siteKey) turnstile.current?.reset();
    setPhase({ kind: 'failed', reason: outcome.reason });
  };

  const startAgain = (): void => {
    setFields({ ...EMPTY_ENQUIRY });
    setErrors({});
    setTurnstileToken(null);
    setPhase({ kind: 'editing' });
  };

  const supportLink = (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="rounded font-medium text-primary-ink underline underline-offset-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
    >
      {CONTACT_EMAIL}
    </a>
  );

  return (
    <MarketingLayout title="Contact">
      <PageHero
        eyebrow="Contact"
        heading="Talk to the people building it"
        body="RotaFlow is small enough that your message reaches someone who works on the product. Ask anything, including what it does not do yet."
      />

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card className="p-7 md:p-9">
            {phase.kind === 'sent' ? (
              <div className="py-8 text-center" role="status">
                <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-success/10 text-success">
                  <CheckCircle2 size={28} aria-hidden="true" />
                </span>
                <h2 className="font-display text-2xl font-bold text-content dark:text-content-dark">
                  Message sent
                </h2>
                <p className="mx-auto mt-3 max-w-md leading-relaxed text-content-muted dark:text-content-muted-dark">
                  Thanks, we&rsquo;ve got your message. We reply within one working day.
                </p>
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                  <Button variant="secondary" onClick={startAgain}>
                    Write another message
                  </Button>
                  <Link to="/signup">
                    <Button className="w-full sm:w-auto">{PRIMARY_CTA}</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={(e) => void onSubmit(e)} noValidate>
                <h2 className="font-display text-xl font-bold text-content dark:text-content-dark">
                  Send us a message
                </h2>
                <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                  Fields marked with an asterisk are required.
                </p>

                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <Field label="Your name" required error={errors.name}>
                    <Input
                      ref={refs.name}
                      name="name"
                      autoComplete="name"
                      maxLength={120}
                      value={fields.name}
                      onChange={(e) => set('name', e.target.value)}
                      placeholder="Alex Morgan"
                    />
                  </Field>

                  <Field label="Work email" required error={errors.workEmail}>
                    <Input
                      ref={refs.workEmail}
                      name="workEmail"
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      value={fields.workEmail}
                      onChange={(e) => set('workEmail', e.target.value)}
                      placeholder="alex@yourorganisation.co.uk"
                    />
                  </Field>

                  <Field label="Organisation" required error={errors.organisation}>
                    <Input
                      ref={refs.organisation}
                      name="organisation"
                      autoComplete="organization"
                      maxLength={160}
                      value={fields.organisation}
                      onChange={(e) => set('organisation', e.target.value)}
                      placeholder="Sunnyvale Care Group"
                    />
                  </Field>

                  <Field label="How many staff?">
                    <Select
                      name="teamSize"
                      value={fields.teamSize}
                      onChange={(e) => set('teamSize', e.target.value)}
                    >
                      <option value="">Prefer not to say</option>
                      {ENQUIRY_TEAM_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Sector" className="sm:col-span-2">
                    <Select
                      name="sector"
                      value={fields.sector}
                      onChange={(e) => set('sector', e.target.value)}
                    >
                      <option value="">Select a sector</option>
                      {ENQUIRY_SECTOR_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Field
                  label="How can we help?"
                  required
                  error={errors.message}
                  className="mt-5"
                >
                  <textarea
                    ref={refs.message}
                    name="message"
                    rows={5}
                    maxLength={5000}
                    value={fields.message}
                    onChange={(e) => set('message', e.target.value)}
                    placeholder="Tell us how you schedule today and what you are trying to fix."
                    className={cn(
                      textareaClass,
                      errors.message && 'border-danger focus-visible:ring-danger',
                    )}
                  />
                </Field>

                <div className="mt-5 space-y-3">
                  <label className="flex items-start gap-2.5 text-sm text-content dark:text-content-dark">
                    <input
                      type="checkbox"
                      name="wantsDemo"
                      checked={fields.wantsDemo}
                      onChange={(e) => set('wantsDemo', e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    />
                    <span>I&rsquo;d like a demo</span>
                  </label>
                  <label className="flex items-start gap-2.5 text-sm text-content dark:text-content-dark">
                    <input
                      type="checkbox"
                      name="marketingConsent"
                      checked={fields.marketingConsent}
                      onChange={(e) => set('marketingConsent', e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    />
                    <span>
                      Send me occasional emails about RotaFlow. Optional: leave it
                      unticked and we only reply to this message.
                    </span>
                  </label>
                </div>

                {/* The honeypot. Off-screen, out of the tab order and hidden
                    from assistive technology, so a person never meets it; a
                    form-filling script usually does. The server answers a
                    filled one exactly like a real message and stores nothing. */}
                <div
                  aria-hidden="true"
                  className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
                >
                  <label htmlFor="contact-website">Website</label>
                  <input
                    id="contact-website"
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={fields.website}
                    onChange={(e) => set('website', e.target.value)}
                  />
                </div>

                {siteKey && (
                  <TurnstileWidget
                    ref={turnstile}
                    siteKey={siteKey}
                    onToken={setTurnstileToken}
                  />
                )}

                {phase.kind === 'failed' && (
                  <div className="mt-6" role="alert">
                    <Callout tone="danger" title="Not sent">
                      <p>
                        {siteKey && !turnstileToken && phase.reason === 'unavailable'
                          ? 'The security check has not finished. Wait a moment and try again.'
                          : FAILURE_TEXT[phase.reason]}{' '}
                        Please email us at {supportLink} instead, and we will reply from
                        there.
                      </p>
                    </Callout>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="mt-7 w-full sm:w-auto"
                  disabled={phase.kind === 'sending'}
                  aria-busy={phase.kind === 'sending' || undefined}
                >
                  {phase.kind === 'sending' ? 'Sending…' : 'Send message'}
                </Button>

                {/* A just-in-time notice: what happens to what is typed here,
                    stated so it can be checked against the Privacy Notice. */}
                <p className="mt-4 text-sm text-content-muted dark:text-content-muted-dark">
                  We store your message so we can reply to it, and delete it after 24
                  months. It is read only by the RotaFlow team, as described in the{' '}
                  <Link
                    to="/legal/privacy"
                    className="font-medium text-primary-ink underline underline-offset-2 dark:text-primary-ink-dark"
                  >
                    Privacy Notice
                  </Link>
                  .
                </p>
              </form>
            )}
          </Card>

          <div className="space-y-5">
            <Card>
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary dark:text-primary-ink-dark">
                <Mail size={20} aria-hidden="true" />
              </span>
              <h2 className="font-display text-base font-semibold text-content dark:text-content-dark">
                Email us directly
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                Prefer your own email client? Write to {supportLink}.
              </p>
            </Card>

            <Card>
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary dark:text-primary-ink-dark">
                <Rocket size={20} aria-hidden="true" />
              </span>
              <h2 className="font-display text-base font-semibold text-content dark:text-content-dark">
                Or just try it
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                You do not need a demo to see RotaFlow. Signing up takes a minute, needs
                no card, and you can build a real week straight away.
              </p>
              <Link to="/signup" className="mt-4 block">
                <Button variant="secondary" className="w-full">
                  {PRIMARY_CTA}
                </Button>
              </Link>
            </Card>

            <Card>
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary dark:text-primary-ink-dark">
                <MessageSquare size={20} aria-hidden="true" />
              </span>
              <h2 className="font-display text-base font-semibold text-content dark:text-content-dark">
                Already a customer?
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                Sign in and use Help &amp; Support in the sidebar. It reaches the same
                people, with your organisation already attached.
              </p>
              <Link to="/login" className="mt-4 block">
                <Button variant="secondary" className="w-full">
                  Log in
                </Button>
              </Link>
            </Card>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
