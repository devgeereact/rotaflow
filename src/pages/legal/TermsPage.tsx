import { Link } from 'react-router-dom';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { NoticeSections } from '@/components/legal/NoticeSections';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { CONTACT_EMAIL } from '@/lib/marketing';
import { TERMS_DRAFTED, TERMS_OUTSTANDING, TERMS_SECTIONS } from '@/lib/termsDraft';

/**
 * `/legal/terms`.
 *
 * This was the one legal route still on the placeholder shell, and the
 * reasoning behind that was half right: a contract is not a description, and
 * the commercial half of it cannot be derived from a codebase.
 *
 * The other half can. Eligibility, roles, acceptable use, what each plan
 * includes, how billing and the grace window work, what deleting an
 * organisation actually does — all of that is a statement about a system that
 * exists, and leaving it unwritten meant a live signup flow with an empty
 * Terms page beside it.
 *
 * So the page is written and banded as a draft. The clauses that are genuine
 * commercial promises — liability, refunds, governing law — say what has to be
 * decided instead of inventing an answer, and they say it where they sit. The
 * banner is part of the page rather than a dismissible notice: nobody should
 * be able to screenshot this without the warning in frame.
 */
export function TermsPage(): JSX.Element {
  return (
    <MarketingLayout title="Terms of Service">
      <PageHero
        eyebrow="Legal"
        heading="Terms of Service"
        body="The terms that would govern use of RotaFlow, for both the organisations that subscribe and the staff they invite. A draft, not an agreement."
      />

      <section className="mx-auto max-w-3xl space-y-8 px-6 py-16">
        <Callout tone="danger" title="Draft — not in force, and not legal advice">
          <p>
            These terms have not been reviewed by a solicitor and nobody is bound by them.
            They were drafted on {TERMS_DRAFTED} from the way the product actually works,
            so the descriptive clauses are accurate and checkable. The commercial ones are
            not written: {TERMS_OUTSTANDING.length} sections below say what is still to be
            decided, including liability and governing law.
          </p>
          <p>
            If you are evaluating RotaFlow and need terms you can rely on, write to{' '}
            {CONTACT_EMAIL} and we will answer in writing rather than pointing you back at
            this page.
          </p>
        </Callout>

        <NoticeSections sections={TERMS_SECTIONS} />

        <Card>
          <h2 className="font-semibold text-content dark:text-content-dark">
            The documents that are finished
          </h2>
          <p className="mt-2 leading-relaxed text-content-muted dark:text-content-muted-dark">
            The{' '}
            <Link to="/legal/privacy" className="underline">
              Privacy Notice
            </Link>{' '}
            and the{' '}
            <Link to="/legal/trust" className="underline">
              Trust page
            </Link>{' '}
            describe how data is handled and who processes it, and each claim in them
            names the file that proves it. The{' '}
            <Link to="/legal/cookies" className="underline">
              Cookie Notice
            </Link>{' '}
            lists everything stored in your browser.
          </p>
          <p className="mt-3 leading-relaxed text-content-muted dark:text-content-muted-dark">
            Questions about any of this go to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Card>
      </section>
    </MarketingLayout>
  );
}
