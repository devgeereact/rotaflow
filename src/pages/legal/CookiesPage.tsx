import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useConsent } from '@/context/ConsentContext';
import {
  DIAGNOSTICS_DISCLOSURE,
  LEGAL_FACTS_REVIEWED,
  STORED_ITEMS,
} from '@/lib/legalFacts';
import type { ConsentCategory } from '@/lib/consent';

const CATEGORY_LABEL: Record<ConsentCategory, string> = {
  necessary: 'Essential',
  preferences: 'Preference',
  diagnostics: 'Crash reporting',
};

/**
 * `/legal/cookies` (CAP-060).
 *
 * The most checkable of the legal pages, and the one that was wrong.
 *
 * It said there was no third-party script and nothing to consent to. The first
 * half was true of `<script>` tags and false in substance: `src/lib/sentry.ts`
 * was running session replay and performance tracing on every route, including
 * this one, before anybody had been asked. Both are gone as of 4 September
 * 2026, the remaining crash reporting is opt-in, and this page now lists what
 * is stored, what is sent, and how to switch each part off.
 *
 * The table is built from `STORED_ITEMS`, which is also what the consent panel
 * renders, so the notice and the control cannot describe different things.
 */
export function CookiesPage(): JSX.Element {
  const { reopen, record } = useConsent();

  return (
    <MarketingLayout title="Cookie Notice">
      <PageHero
        eyebrow="Legal"
        heading="Cookies and browser storage"
        body="RotaFlow sets no cookies. Here is everything it does keep on your device, everything it sends off it, and how to change your mind."
      />

      <section className="mx-auto max-w-3xl space-y-8 px-6 py-16">
        <Card className="bg-surface-muted dark:bg-surface-muted-dark">
          <p className="leading-relaxed text-content dark:text-content-dark">
            <strong>There are no cookies, no analytics and no advertising.</strong> There
            is no tag manager, no advertising pixel and nothing that follows you to
            another site. Everything in the table below is stored by your own browser and
            stays on this device.
          </p>
          <p className="mt-3 leading-relaxed text-content-muted dark:text-content-muted-dark">
            One thing does leave the browser, and it is easier to name it than to write
            around it. If the app crashes, an error report can be sent to Sentry so the
            fault can be found. {DIAGNOSTICS_DISCLOSURE.detail} It is off unless you turn
            it on.
          </p>
          <p className="mt-3 leading-relaxed text-content-muted dark:text-content-muted-dark">
            Signing in, staying in the right organisation and holding work you did offline
            all need storage on this device, so those cannot be switched off: the app
            would not function without them. Everything else is a choice, and declining
            costs you two conveniences and nothing more.
          </p>
        </Card>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Everything RotaFlow stores in your browser, and whether it is essential
            </caption>
            <thead className="border-b border-surface-border dark:border-surface-border-dark">
              <tr>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  What
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Category
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Why
                </th>
                <th scope="col" className="py-2 font-semibold">
                  How long
                </th>
              </tr>
            </thead>
            <tbody>
              {STORED_ITEMS.map((item) => (
                <tr
                  key={item.key}
                  className="border-b border-surface-border align-top dark:border-surface-border-dark"
                >
                  <td className="py-3 pr-4 font-mono text-xs text-content dark:text-content-dark">
                    {item.key}
                  </td>
                  <td className="py-3 pr-4 text-content-muted dark:text-content-muted-dark">
                    {CATEGORY_LABEL[item.category]}
                  </td>
                  <td className="py-3 pr-4 text-content-muted dark:text-content-muted-dark">
                    {item.purpose}
                  </td>
                  <td className="py-3 text-content-muted dark:text-content-muted-dark">
                    {item.lifetime}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Card className="space-y-3">
          <h2 className="font-display text-xl font-bold text-content dark:text-content-dark">
            Change your mind
          </h2>
          <p className="leading-relaxed text-content-muted dark:text-content-muted-dark">
            {record === null
              ? 'You have not answered yet, and nothing optional is being stored or sent in the meantime.'
              : `You answered on ${new Date(record.decidedAt).toLocaleDateString(
                  'en-GB',
                  {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  },
                )}: interface preferences are ${
                  record.preferences ? 'on' : 'off'
                } and crash reporting is ${record.diagnostics ? 'on' : 'off'}.`}{' '}
            Turning something off also deletes what it had already saved here. Clearing
            site data in your browser removes everything on this page, including your
            answer.
          </p>
          <div>
            <Button variant="secondary" onClick={reopen}>
              Change your preferences
            </Button>
          </div>
        </Card>

        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Checked against the code on {LEGAL_FACTS_REVIEWED}. If this list is wrong, it is
          a bug — tell us and it will be corrected.
        </p>
      </section>
    </MarketingLayout>
  );
}
