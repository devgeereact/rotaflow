import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Mail, MessageSquare, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { CONTACT_EMAIL, PRIMARY_CTA, SECTORS } from '@/lib/marketing';
import { cn } from '@/lib/utils';

/**
 * `/contact`.
 *
 * ## Why this composes an email rather than posting to an endpoint
 *
 * There is no contact table, no form-handling Edge Function and no CRM. The
 * three options were: post nowhere and show a success message anyway, build a
 * public unauthenticated write endpoint, or hand the composed message to the
 * visitor's own mail client.
 *
 * The first is a lie. The brief's own rule is no dead buttons, and a fake
 * "thanks, we'll be in touch" is the worst kind because the visitor believes
 * it. The second is a public unauthenticated write on a multi-tenant database
 * holding staff PII: it needs rate limiting, spam handling and an RLS policy
 * that lets anon INSERT, which is a meaningful new attack surface for a
 * contact form.
 *
 * So the form validates properly and then opens a pre-filled message. The
 * address is also shown as plain selectable text, because `mailto:` does
 * nothing useful on a device with no mail client configured, and a visitor who
 * hits that must still be able to reach us.
 *
 * Replace this with a real endpoint when one exists. The validation and the
 * success state are already here and do not need to change.
 */

type Enquiry = 'demo' | 'question' | 'pricing' | 'support';

const ENQUIRIES: { value: Enquiry; label: string }[] = [
  { value: 'demo', label: 'Book a demo' },
  { value: 'question', label: 'A question about the product' },
  { value: 'pricing', label: 'Pricing or plans' },
  { value: 'support', label: 'Help with my account' },
];

interface Fields {
  name: string;
  email: string;
  organisation: string;
  sector: string;
  teamSize: string;
  enquiry: Enquiry;
  message: string;
}

const EMPTY: Fields = {
  name: '',
  email: '',
  organisation: '',
  sector: '',
  teamSize: '',
  enquiry: 'demo',
  message: '',
};

type Errors = Partial<Record<keyof Fields, string>>;

/**
 * Deliberately permissive: `something@something.tld`. Stricter patterns reject
 * valid addresses (apostrophes, long TLDs, subdomains) and the real check is
 * whether the reply arrives.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The order the fields appear in, so a failed submit can move focus to the
 * first invalid ONE — the first in the form, not the first the object happens
 * to enumerate. Also the id prefix each one is rendered with.
 */
const FIELD_ORDER = ['name', 'email', 'organisation', 'message'] as const;

const FIELD_IDS: Record<(typeof FIELD_ORDER)[number], string> = {
  name: 'contact-name',
  email: 'contact-email',
  organisation: 'contact-org',
  message: 'contact-message',
};

function validate(fields: Fields): Errors {
  const errors: Errors = {};
  if (!fields.name.trim()) errors.name = 'Enter your name.';
  if (!fields.email.trim()) errors.email = 'Enter your email address.';
  else if (!EMAIL_PATTERN.test(fields.email.trim()))
    errors.email = 'That does not look like an email address.';
  if (!fields.organisation.trim()) errors.organisation = 'Enter your organisation.';
  if (!fields.message.trim()) errors.message = 'Tell us a little about what you need.';
  else if (fields.message.trim().length < 10)
    errors.message = 'A bit more detail helps us give you a useful answer.';
  return errors;
}

function composeMailto(fields: Fields): string {
  const label = ENQUIRIES.find((e) => e.value === fields.enquiry)?.label ?? 'Enquiry';
  const body = [
    `Name: ${fields.name}`,
    `Organisation: ${fields.organisation}`,
    fields.sector && `Sector: ${fields.sector}`,
    fields.teamSize && `Team size: ${fields.teamSize}`,
    '',
    fields.message,
  ]
    .filter(Boolean)
    .join('\n');

  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    `${label}, ${fields.organisation}`,
  )}&body=${encodeURIComponent(body)}`;
}

export function ContactPage(): JSX.Element {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [sent, setSent] = useState(false);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]): void => {
    setFields((prev) => ({ ...prev, [key]: value }));
    // Clear the field's own error as soon as the user edits it. Leaving it up
    // while they are fixing it reads as though the fix did not register.
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const found = validate(fields);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Focus the first invalid field, chosen from the validation result
      // rather than from the DOM.
      //
      // This used to be `document.querySelector('[aria-invalid="true"]')` in
      // this same handler, which cannot work: `setErrors` is batched, so on the
      // first failed submit nothing carries `aria-invalid` yet and the query
      // returns null — focus never moved, and somebody using a keyboard or a
      // screen reader was told there were errors and left where they stood. On
      // later submits it found the PREVIOUS render's first invalid field, which
      // is worse than not moving.
      const firstInvalid = FIELD_ORDER.find((key) => found[key] !== undefined);
      if (firstInvalid) {
        document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      }
      return;
    }
    window.location.href = composeMailto(fields);
    setSent(true);
  };

  const fieldError = (key: keyof Fields): JSX.Element | null =>
    errors[key] ? (
      <p id={`${key}-error`} role="alert" className="mt-1.5 text-sm text-danger">
        {errors[key]}
      </p>
    ) : null;

  const inputProps = (key: keyof Fields): Record<string, unknown> => ({
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${key}-error` : undefined,
    className: errors[key] ? 'border-danger focus-visible:ring-danger' : undefined,
  });

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
            {sent ? (
              <div className="py-8 text-center">
                <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-success/10 text-success">
                  <CheckCircle2 size={28} aria-hidden="true" />
                </span>
                <h2 className="font-display text-2xl font-bold text-content dark:text-content-dark">
                  Your message is ready to send
                </h2>
                <p className="mx-auto mt-3 max-w-md leading-relaxed text-content-muted dark:text-content-muted-dark">
                  We have opened it in your email app with everything filled in. Press
                  send there and it reaches us. If nothing opened, email us directly at{' '}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="rounded font-medium text-primary-ink dark:text-primary-ink-dark underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {CONTACT_EMAIL}
                  </a>
                  .
                </p>
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSent(false);
                      setFields(EMPTY);
                    }}
                  >
                    Write another message
                  </Button>
                  <Link to="/signup">
                    <Button className="w-full sm:w-auto">{PRIMARY_CTA}</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate>
                <h2 className="font-display text-xl font-bold text-content dark:text-content-dark">
                  Send us a message
                </h2>
                <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                  Fields marked with an asterisk are required.
                </p>

                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="contact-name">Your name *</Label>
                    <Input
                      id="contact-name"
                      name="name"
                      autoComplete="name"
                      value={fields.name}
                      onChange={(e) => set('name', e.target.value)}
                      placeholder="Alex Morgan"
                      {...inputProps('name')}
                    />
                    {fieldError('name')}
                  </div>

                  <div>
                    <Label htmlFor="contact-email">Work email *</Label>
                    <Input
                      id="contact-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={fields.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="alex@yourorganisation.co.uk"
                      {...inputProps('email')}
                    />
                    {fieldError('email')}
                  </div>

                  <div>
                    <Label htmlFor="contact-org">Organisation *</Label>
                    <Input
                      id="contact-org"
                      name="organisation"
                      autoComplete="organization"
                      value={fields.organisation}
                      onChange={(e) => set('organisation', e.target.value)}
                      placeholder="Sunnyvale Care Group"
                      {...inputProps('organisation')}
                    />
                    {fieldError('organisation')}
                  </div>

                  <div>
                    <Label htmlFor="contact-size">How many staff?</Label>
                    <Select
                      id="contact-size"
                      name="teamSize"
                      value={fields.teamSize}
                      onChange={(e) => set('teamSize', e.target.value)}
                    >
                      <option value="">Prefer not to say</option>
                      <option value="1-25">1-25</option>
                      <option value="26-100">26-100</option>
                      <option value="101-500">101-500</option>
                      <option value="500+">500+</option>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="contact-sector">Sector</Label>
                    <Select
                      id="contact-sector"
                      name="sector"
                      value={fields.sector}
                      onChange={(e) => set('sector', e.target.value)}
                    >
                      <option value="">Select a sector</option>
                      {SECTORS.map(({ name }) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                      <option value="Other">Something else</option>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="contact-enquiry">What is this about?</Label>
                    <Select
                      id="contact-enquiry"
                      name="enquiry"
                      value={fields.enquiry}
                      onChange={(e) => set('enquiry', e.target.value as Enquiry)}
                    >
                      {ENQUIRIES.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="mt-5">
                  <Label htmlFor="contact-message">How can we help? *</Label>
                  <textarea
                    id="contact-message"
                    name="message"
                    rows={5}
                    value={fields.message}
                    onChange={(e) => set('message', e.target.value)}
                    placeholder="Tell us how you schedule today and what you are trying to fix."
                    aria-invalid={errors.message ? true : undefined}
                    aria-describedby={errors.message ? 'message-error' : undefined}
                    className={cn(
                      'w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none',
                      'placeholder:text-content-muted focus-visible:ring-2 focus-visible:ring-primary',
                      'dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark',
                      errors.message && 'border-danger focus-visible:ring-danger',
                    )}
                  />
                  {fieldError('message')}
                </div>

                <Button type="submit" size="lg" className="mt-7 w-full sm:w-auto">
                  Send message
                </Button>
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
                Prefer your own email client? Write to{' '}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="rounded font-medium text-primary-ink dark:text-primary-ink-dark underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {CONTACT_EMAIL}
                </a>
                .
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
