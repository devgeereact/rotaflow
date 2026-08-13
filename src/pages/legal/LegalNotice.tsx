import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { Card } from '@/components/ui/Card';
import { CONTACT_EMAIL } from '@/lib/marketing';

interface LegalNoticeProps {
  title: string;
  eyebrow: string;
  summary: string;
}

/**
 * Shared shell for the four legal-IA pages (Privacy, Terms, Cookies,
 * Accessibility). These are placeholders, not the published policies: the
 * final text needs UK counsel review (see docs/PRODUCT_TRANSFORMATION_PLAN.md
 * P0 #1) and must not be drafted here. What this establishes now is the site
 * structure — a real, linkable route for each policy — so the footer and any
 * external audit of "does this site have a privacy page" finds a truthful
 * answer instead of a dead link.
 */
export function LegalNotice({ title, eyebrow, summary }: LegalNoticeProps): JSX.Element {
  return (
    <MarketingLayout title={title}>
      <PageHero eyebrow={eyebrow} heading={title} body={summary} />

      <section className="mx-auto max-w-2xl px-6 py-16">
        <Card className="space-y-4">
          <p className="leading-relaxed text-content dark:text-content-dark">
            RotaFlow is in a pre-launch beta. This page is a placeholder while the
            published {title.toLowerCase()} is finalised with UK legal counsel ahead of
            the external beta — it is not itself legal advice or a binding policy.
          </p>
          <p className="leading-relaxed text-content-muted dark:text-content-muted-dark">
            If you need this information now — for a data-processing question, a
            procurement review or anything else — contact us directly and we will answer
            in writing.
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-flex items-center gap-2 rounded font-medium text-primary-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Mail size={16} aria-hidden="true" />
            {CONTACT_EMAIL}
          </a>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Or use the{' '}
            <Link
              to="/contact"
              className="rounded font-medium text-primary-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              contact form
            </Link>
            .
          </p>
        </Card>
      </section>
    </MarketingLayout>
  );
}
