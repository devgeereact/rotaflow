import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { MARKETING_NAV } from '@/lib/marketing';

/**
 * The page a mistyped URL, a stale bookmark or a dead external link lands on.
 *
 * It used to be a bare `<main>`: a 404, one sentence and one button, with no
 * navigation, no footer and no `<title>`, so the tab read whatever the last
 * page had set. That is a dead end at the exact moment somebody is deciding
 * whether this site is worth another click, and it is reached by every
 * unknown path — including, on a static SPA, every asset a stale service
 * worker asks for by a name that no longer exists.
 *
 * Wrapping it in `MarketingLayout` gives it the nav and footer, so the way out
 * is the same one every other public page offers.
 *
 * `noindex` because the SPA fallback answers an unknown path with HTTP 200:
 * the server cannot tell a crawler this page does not exist, so the page has
 * to say so itself. A crawler that already has a dead URL should drop it
 * rather than index sixteen identical "not found" pages.
 */
export function NotFoundPage(): JSX.Element {
  return (
    <MarketingLayout title="Page not found" noindex>
      <div className="mx-auto grid max-w-2xl place-items-center px-6 py-24 text-center sm:py-32">
        <p className="font-display text-7xl font-extrabold text-primary dark:text-primary-ink-dark">
          404
        </p>
        <h1 className="mt-6 font-display text-3xl font-bold text-content dark:text-content-dark">
          This page doesn’t exist
        </h1>
        <p className="mt-3 text-content-muted dark:text-content-muted-dark">
          The link may be out of date, or the address may have a typo in it. Nothing has
          gone wrong with your account.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/">
            <Button>Back to home</Button>
          </Link>
          <Link to="/login">
            <Button variant="secondary">Sign in</Button>
          </Link>
        </div>

        <nav aria-label="Main pages" className="mt-10">
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {MARKETING_NAV.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="text-sm font-medium text-primary-ink underline-offset-4 hover:underline dark:text-primary-ink-dark"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </MarketingLayout>
  );
}
