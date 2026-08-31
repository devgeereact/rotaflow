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
 * The shell for a legal page that genuinely cannot be written yet.
 *
 * It used to back all four routes. Three of them — Privacy, Cookies and
 * Accessibility — are now written (CAP-060), because each is a DESCRIPTION
 * of what the software does rather than a commitment, and a description can
 * be checked against the code. A live public site whose Privacy page says
 * "this is a placeholder" reads as "nobody has thought about this", which is
 * worse than the short accurate statement that was available all along.
 *
 * **Terms of Service still uses this**, and should. A contract is not a
 * description: it says what we owe a customer if something goes wrong, and
 * inventing that from a codebase would be worse than admitting it is not
 * written. This page says which, and offers a person instead.
 */
export function LegalNotice({ title, eyebrow, summary }: LegalNoticeProps): JSX.Element {
  return (
    <MarketingLayout title={title}>
      <PageHero eyebrow={eyebrow} heading={title} body={summary} />

      <section className="mx-auto max-w-2xl px-6 py-16">
        <Card className="space-y-4">
          <p className="leading-relaxed text-content dark:text-content-dark">
            RotaFlow is in a pre-launch beta and the {title.toLowerCase()} has not been
            published. It is a contract rather than a description of the software, so it
            is being prepared with UK legal counsel rather than drafted here — this page
            is not legal advice and not a binding policy.
          </p>
          <p className="leading-relaxed text-content-muted dark:text-content-muted-dark">
            If you are evaluating RotaFlow and need terms now, ask: we will send what
            exists and answer in writing rather than pointing you back at this page. For
            how the software actually handles data, the Privacy, Cookie and Trust pages
            are written and checked against the code.
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-flex items-center gap-2 rounded font-medium text-primary-ink dark:text-primary-ink-dark underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Mail size={16} aria-hidden="true" />
            {CONTACT_EMAIL}
          </a>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Or use the{' '}
            <Link
              to="/contact"
              className="rounded font-medium text-primary-ink dark:text-primary-ink-dark underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
