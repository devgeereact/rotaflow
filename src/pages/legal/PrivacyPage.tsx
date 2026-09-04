import { Link } from 'react-router-dom';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { FactList } from '@/components/legal/FactList';
import { NoticeSections } from '@/components/legal/NoticeSections';
import { Card } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Callout';
import { CONTACT_EMAIL } from '@/lib/marketing';
import { LEGAL_FACTS_REVIEWED, PRIVACY_FACTS } from '@/lib/legalFacts';
import {
  PRIVACY_NOTICE_DRAFTED,
  PRIVACY_NOTICE_OUTSTANDING,
  PRIVACY_NOTICE_SECTIONS,
} from '@/lib/privacyNotice';

/**
 * `/legal/privacy` (CAP-060).
 *
 * Two documents on one page, in the order a reader needs them.
 *
 * First the six summary facts, which are what somebody actually wants: who the
 * data is about, who decides, where it goes, is it sold, how long, can it be
 * removed. They were the whole page until 4 September 2026 and they were true,
 * but they are a summary and not a notice.
 *
 * Then the notice itself, from `src/lib/privacyNotice.ts`. It is a draft, it
 * says so at the top, and the sections that cannot be settled from the code
 * carry their own warning in place rather than being quietly omitted. Omitting
 * them would produce a document that reads as finished — which is the failure
 * this page has already had once, when the summary described "no tracking"
 * while the app was running session replay.
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
        <Callout tone="warning" title="This notice is a draft, not a published policy">
          <p>
            It was written on {PRIVACY_NOTICE_DRAFTED} from the code, and every
            description in it can be checked against the file named beneath it. What it
            does not have is a solicitor’s eye: {PRIVACY_NOTICE_OUTSTANDING.length}{' '}
            sections below are marked as needing either a decision from us or qualified
            legal advice, and they are marked where they sit rather than in a footnote.
            Nothing here is legal advice.
          </p>
        </Callout>

        <Card className="bg-surface-muted dark:bg-surface-muted-dark">
          <p className="leading-relaxed text-content dark:text-content-dark">
            The short version first, checked against the code on {LEGAL_FACTS_REVIEWED}.
            If you are an employer evaluating RotaFlow, the processing terms you would
            sign are a separate document that does not exist yet — ask and we will send
            what does rather than pointing you at a page.
          </p>
        </Card>

        <FactList facts={PRIVACY_FACTS} />

        <div className="border-t border-surface-border pt-10 dark:border-surface-border-dark">
          <h2 className="font-display text-2xl font-bold text-content dark:text-content-dark">
            The full notice
          </h2>
          <p className="mt-2 leading-relaxed text-content-muted dark:text-content-muted-dark">
            Longer, and more specific. Each section names where in the software its claims
            can be verified.
          </p>
        </div>

        <NoticeSections sections={PRIVACY_NOTICE_SECTIONS} />

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
