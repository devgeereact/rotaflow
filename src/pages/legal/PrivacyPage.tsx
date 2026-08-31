import { Link } from 'react-router-dom';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { FactList } from '@/components/legal/FactList';
import { Card } from '@/components/ui/Card';
import { CONTACT_EMAIL } from '@/lib/marketing';
import { LEGAL_FACTS_REVIEWED, PRIVACY_FACTS } from '@/lib/legalFacts';

/**
 * `/legal/privacy` (CAP-060).
 *
 * This was a placeholder saying the real notice was being drafted. That is
 * honest on day one and misleading by month three — and everything below is
 * a DESCRIPTION of what the software does, not a policy commitment, so it
 * did not need counsel to be written truthfully.
 *
 * Each answer is checkable against the system: residency against
 * `docs/DATA_LIFECYCLE.md` and `src/lib/subprocessors.ts`, retention against
 * the `retention_policies` table the nightly job reads, export and erasure
 * against the functions that perform them.
 *
 * What is still NOT here is anything that would be a promise rather than a
 * description — a stated lawful basis for each purpose, a retention
 * commitment to a customer, a complaints procedure. Those belong in a
 * customer contract and to counsel, and the page says so rather than
 * inventing them.
 */
export function PrivacyPage(): JSX.Element {
  return (
    <MarketingLayout title="Privacy">
      <PageHero
        eyebrow="Legal"
        heading="Privacy"
        body="What RotaFlow holds about the people who use it, where it goes, and what can be done with it."
      />

      <section className="mx-auto max-w-3xl space-y-8 px-6 py-16">
        <Card className="bg-surface-muted dark:bg-surface-muted-dark">
          <p className="leading-relaxed text-content dark:text-content-dark">
            This page describes how the software behaves, checked against the code on{' '}
            {LEGAL_FACTS_REVIEWED}. It is not a contract and not legal advice. If you are
            an employer evaluating RotaFlow, the processing terms you would sign are a
            separate document and are being prepared with UK counsel — ask and we will
            send what exists today rather than pointing you at a page.
          </p>
        </Card>

        <FactList facts={PRIVACY_FACTS} />

        <Card>
          <h2 className="font-semibold text-content dark:text-content-dark">
            Where to check any of this
          </h2>
          <p className="mt-2 leading-relaxed text-content-muted dark:text-content-muted-dark">
            The{' '}
            <Link to="/legal/trust" className="underline">
              Trust page
            </Link>{' '}
            lists every sub-processor, what each one receives and whether it is outside
            the UK and EU. The{' '}
            <Link to="/legal/cookies" className="underline">
              Cookie notice
            </Link>{' '}
            lists everything stored in your browser — there are no cookies at all.
          </p>
          <p className="mt-3 leading-relaxed text-content-muted dark:text-content-muted-dark">
            Questions about your own data go to your employer first: they decide what is
            held and why. For anything about the software itself, write to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
              {CONTACT_EMAIL}
            </a>{' '}
            and we will answer in writing.
          </p>
        </Card>
      </section>
    </MarketingLayout>
  );
}
