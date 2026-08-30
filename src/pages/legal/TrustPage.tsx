import { AlertTriangle, Globe2, ShieldCheck } from 'lucide-react';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { CONTACT_EMAIL } from '@/lib/marketing';
import { SUB_PROCESSORS, SUB_PROCESSORS_REVIEWED } from '@/lib/subprocessors';

/**
 * `/legal/trust` — the sub-processor list, the AI transparency notice and the
 * security disclosure policy (docs/SAAS.md GAP-014).
 *
 * ## Why this page exists and the DPA does not
 *
 * GAP-014 asked for four things. Three of them are statements of fact about
 * how the system works, so they can be written truthfully from the code and
 * are here. The fourth, a Data Processing Agreement, is a binding contract:
 * drafting one is legal advice, `LegalNotice` says the published policies need
 * UK counsel and must not be drafted in this repo, and that applies here too.
 *
 * That is not a cop-out about the hard part. A DPA's substance is its
 * sub-processor schedule and its description of the processing — which is
 * precisely what this page is, dated and evidenced. Counsel drafting the
 * agreement can take it as the input rather than asking us to compile it.
 *
 * ## Why it is a real page rather than a PDF on request
 *
 * "Email us and we'll send it" is the answer that loses the deal at the
 * procurement stage, and it is also the answer that lets the list quietly go
 * stale. This one is built from `src/lib/subprocessors.ts`, which cites a file
 * per row, so it changes when the system changes.
 */
export function TrustPage(): JSX.Element {
  const crossBorder = SUB_PROCESSORS.filter((p) => p.outsideUkEu);

  return (
    <MarketingLayout title="Trust and sub-processors">
      <PageHero
        eyebrow="Legal"
        heading="Trust and sub-processors"
        body="Who processes data on our behalf, what leaves the UK and EU, what the AI assistant is sent, and how to report a security problem."
      />

      <section className="mx-auto max-w-4xl space-y-8 px-6 py-16">
        {/* First, because it is the question a procurement reviewer opens this
            page to answer. Putting it below the routine infrastructure rows
            would be a decision about what they notice. */}
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Globe2 size={18} className="text-primary" aria-hidden="true" />
            <h2 className="font-semibold text-content dark:text-content-dark">
              What leaves the UK and EU
            </h2>
          </div>
          <p className="mb-4 leading-relaxed text-content dark:text-content-dark">
            Your data lives in the European Union. The database, authentication, file
            storage and server functions all run in <strong>eu-west-1 (Ireland)</strong>,
            error monitoring uses an EU region, and the site and its outbound mail are
            hosted in the <strong>United Kingdom</strong>.
          </p>
          <p className="mb-4 leading-relaxed text-content dark:text-content-dark">
            {crossBorder.length} of our {SUB_PROCESSORS.length} sub-processors are outside
            that area, both in the United States:{' '}
            <strong>{crossBorder.map((p) => p.name.split(',')[0]).join(' and ')}</strong>.
            Neither receives anything unless you use the feature it powers — the AI
            assistant, or a paid subscription. Both are listed in full below.
          </p>
          <p className="leading-relaxed text-content-muted dark:text-content-muted-dark">
            We would rather say this plainly than describe ourselves as EU-only and bury
            the exceptions. If your organisation cannot send staff data to a US processor,
            the AI assistant is the only feature you need to avoid, and not using it sends
            nothing.
          </p>
        </Card>

        <Card className="p-0">
          <div className="border-b border-surface-border p-5 dark:border-surface-border-dark">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Sub-processors
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              Every row names the file or setting that proves it. Last checked against the
              code on {SUB_PROCESSORS_REVIEWED}.
            </p>
          </div>
          <ul>
            {SUB_PROCESSORS.map((p) => (
              <li
                key={p.name}
                className="border-b border-surface-border p-5 last:border-0 dark:border-surface-border-dark"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-content dark:text-content-dark">
                    {p.name}
                  </h3>
                  {p.outsideUkEu ? (
                    <Badge tone="warning" dot>
                      Outside the UK and EU
                    </Badge>
                  ) : (
                    <Badge tone="success" dot>
                      UK or EU
                    </Badge>
                  )}
                </div>
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-sm font-medium text-content-muted dark:text-content-muted-dark">
                    What it does
                  </dt>
                  <dd className="text-sm text-content dark:text-content-dark">
                    {p.purpose}
                  </dd>

                  <dt className="text-sm font-medium text-content-muted dark:text-content-muted-dark">
                    Personal data
                  </dt>
                  <dd className="text-sm text-content dark:text-content-dark">
                    {p.personalData}
                  </dd>

                  <dt className="text-sm font-medium text-content-muted dark:text-content-muted-dark">
                    Where
                  </dt>
                  <dd className="text-sm text-content dark:text-content-dark">
                    {p.region}
                  </dd>

                  <dt className="text-sm font-medium text-content-muted dark:text-content-muted-dark">
                    Can you avoid it
                  </dt>
                  <dd className="text-sm text-content dark:text-content-dark">
                    {p.optOut ?? 'No — it is part of running the product.'}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={18} className="text-primary" aria-hidden="true" />
            <h2 className="font-semibold text-content dark:text-content-dark">
              The AI assistant, in detail
            </h2>
          </div>
          <p className="mb-3 leading-relaxed text-content dark:text-content-dark">
            The assistant has three tabs. Two of them — reviewing a rota and finding
            coverage gaps — run entirely on rows your organisation already holds and make
            no network call. Only <strong>Ask AI</strong>, and AI-drafted announcements,
            send anything anywhere.
          </p>
          <p className="mb-3 leading-relaxed text-content dark:text-content-dark">
            When you use them, this is what is sent, and nothing else: the first and last
            names, job titles, skills, weekly hours and contract type of your active
            staff; the shifts, shift types and locations for the week being drafted; the{' '}
            <strong>dates</strong> of approved leave; and the days people have marked
            themselves unavailable.
          </p>
          <p className="mb-3 leading-relaxed text-content dark:text-content-dark">
            <strong>Leave type is not sent.</strong> The assistant needs to know that
            somebody is away, not why, so it is given the dates without the reason. That
            matters because sickness is health data, and it should not travel further than
            the people who have to act on it. We were sending it until we wrote this page;
            we are not any more.
          </p>
          <p className="mb-3 leading-relaxed text-content dark:text-content-dark">
            No clock-in records, GPS positions, documents, contact details, pay
            information or audit history are ever sent. The assistant only ever{' '}
            <strong>suggests</strong>: nothing it produces is saved to a rota, and nothing
            reaches your staff, until a manager reads it and applies it.
          </p>
          <p className="leading-relaxed text-content-muted dark:text-content-muted-dark">
            Requests go through OpenRouter to the model provider behind it. We do not use
            your data to train models and we do not permit it to be used for training. If
            you need that commitment contractually rather than as a sentence on a page,
            ask us and we will put it in writing.
          </p>
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={18} className="text-primary" aria-hidden="true" />
            <h2 className="font-semibold text-content dark:text-content-dark">
              Reporting a security problem
            </h2>
          </div>
          <p className="mb-3 leading-relaxed text-content dark:text-content-dark">
            If you have found a vulnerability, email{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium text-primary hover:underline"
            >
              {CONTACT_EMAIL}
            </a>{' '}
            with enough detail to reproduce it. We will acknowledge within{' '}
            <strong>two working days</strong> and tell you what we intend to do and
            roughly when.
          </p>
          <p className="mb-3 leading-relaxed text-content dark:text-content-dark">
            Please give us a reasonable chance to fix it before publishing, do not access
            or modify anyone else&rsquo;s data, and do not run tests that degrade the
            service for other customers. Report what you found rather than proving how far
            it goes. Stay within those lines and we will not pursue you for the report.
          </p>
          <p className="leading-relaxed text-content-muted dark:text-content-muted-dark">
            We do not currently run a paid bug-bounty programme. We would rather say so
            than imply one exists.
          </p>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold text-content dark:text-content-dark">
            Data Processing Agreement
          </h2>
          <p className="mb-3 leading-relaxed text-content dark:text-content-dark">
            A DPA is a contract, and ours is with UK counsel rather than drafted in-house
            — the same reason the Privacy Notice and Terms are still being finalised. What
            it will schedule is the list above, which is why that list is published and
            dated now instead of waiting.
          </p>
          <p className="leading-relaxed text-content dark:text-content-dark">
            If you need a DPA signed before you can proceed, email{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium text-primary hover:underline"
            >
              {CONTACT_EMAIL}
            </a>{' '}
            and say so — it moves things along, and we will answer any question on this
            page in writing in the meantime.
          </p>
        </Card>
      </section>
    </MarketingLayout>
  );
}
