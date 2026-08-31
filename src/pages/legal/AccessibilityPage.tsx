import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { FactList } from '@/components/legal/FactList';
import { Card } from '@/components/ui/Card';
import { CONTACT_EMAIL } from '@/lib/marketing';
import { ACCESSIBILITY_FACTS, LEGAL_FACTS_REVIEWED } from '@/lib/legalFacts';

/**
 * `/legal/accessibility` (CAP-060).
 *
 * The honest half of this page matters more than the tidy half. A statement
 * claiming WCAG AA without saying what was tested is a claim nobody can
 * check, and exactly the sort of thing a procurement review is right to
 * distrust. So this says what the automated gate covers, says plainly that
 * an automated scan finds a minority of real problems, and does not claim an
 * audit that has not happened.
 */
export function AccessibilityPage(): JSX.Element {
  return (
    <MarketingLayout title="Accessibility">
      <PageHero
        eyebrow="Legal"
        heading="Accessibility"
        body="What is tested, what is not, and what to do if something is in your way."
      />

      <section className="mx-auto max-w-3xl space-y-8 px-6 py-16">
        <Card className="bg-surface-muted dark:bg-surface-muted-dark">
          <p className="leading-relaxed text-content dark:text-content-dark">
            RotaFlow aims at <strong>WCAG 2.1 AA</strong>. We have not been through a
            formal audit by an accessibility specialist, so this page describes what is
            actually verified rather than claiming a standard is met. Checked on{' '}
            {LEGAL_FACTS_REVIEWED}.
          </p>
        </Card>

        <FactList facts={ACCESSIBILITY_FACTS} />

        <Card>
          <h2 className="font-semibold text-content dark:text-content-dark">
            Tell us what is not working
          </h2>
          <p className="mt-2 leading-relaxed text-content-muted dark:text-content-muted-dark">
            Write to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
              {CONTACT_EMAIL}
            </a>
            . Say what you were trying to do and what got in the way — that is more useful
            than a standard reference, and we will reply with what we are going to do and
            when.
          </p>
        </Card>
      </section>
    </MarketingLayout>
  );
}
