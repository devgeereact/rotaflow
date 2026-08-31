import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { Card } from '@/components/ui/Card';
import { LEGAL_FACTS_REVIEWED, STORED_ITEMS } from '@/lib/legalFacts';

/**
 * `/legal/cookies` (CAP-060).
 *
 * The most checkable of the four, and the one where a placeholder was least
 * defensible: what a site stores in a browser is not a matter of opinion.
 *
 * RotaFlow sets **no cookies**. Everything it keeps is `localStorage` or
 * IndexedDB on the device, none of it is used to track anybody, and there is
 * no third-party script on the site — so there is nothing to ask consent
 * for, and a consent banner would be theatre. Saying that plainly, with the
 * list to back it, is worth more than a banner.
 */
export function CookiesPage(): JSX.Element {
  return (
    <MarketingLayout title="Cookie Notice">
      <PageHero
        eyebrow="Legal"
        heading="Cookies and browser storage"
        body="RotaFlow sets no cookies. Here is everything it does keep on your device, and why."
      />

      <section className="mx-auto max-w-3xl space-y-8 px-6 py-16">
        <Card className="bg-surface-muted dark:bg-surface-muted-dark">
          <p className="leading-relaxed text-content dark:text-content-dark">
            <strong>There are no cookies, no analytics and no advertising.</strong> No
            third-party script runs on this site. Everything in the list below is stored
            by your own browser, stays on this device, and is there to make the app work
            or to remember a choice you made. None of it identifies you to anybody else or
            follows you anywhere.
          </p>
          <p className="mt-3 leading-relaxed text-content-muted dark:text-content-muted-dark">
            That is why there is no consent banner: there is nothing here that consent
            would be the basis for. Clearing site data in your browser removes all of it,
            and signing out removes the first two.
          </p>
        </Card>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Everything RotaFlow stores in your browser
            </caption>
            <thead className="border-b border-surface-border dark:border-surface-border-dark">
              <tr>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  What
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

        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Checked against the code on {LEGAL_FACTS_REVIEWED}. If this list is wrong, it is
          a bug — tell us and it will be corrected.
        </p>
      </section>
    </MarketingLayout>
  );
}
