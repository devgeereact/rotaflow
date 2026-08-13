import { Link } from 'react-router-dom';
import { FOOTER_COLUMNS, TAGLINE } from '@/lib/marketing';
import { BrandMark } from '@/components/ui/BrandMark';

/**
 * Site footer.
 *
 * Still no social row, press mentions or postal address. None of those exist,
 * and an unmonitored mailto or a link to a nonexistent account is worse than
 * omitting the row. What changed since the minimal version is that there are
 * now real destinations to link: `/features`, `/solutions`, `/pricing`,
 * `/resources`, `/about` and `/contact` are routed pages, and
 * `navigationTargets.test.ts` asserts every link in `FOOTER_COLUMNS` resolves
 * so this cannot quietly rot back into pointing at 404s.
 *
 * Legal links now point at real routes under `/legal/*`, not stubs: each one
 * renders a page that states plainly it is a placeholder pending UK-counsel
 * review, with a direct way to ask a question in the meantime (see
 * `LegalNotice`). That was the bar the previous version of this comment set —
 * no link to a page that does not exist — and it is met without waiting on
 * final legal text, which is tracked separately in
 * docs/PRODUCT_TRANSFORMATION_PLAN.md P0 #1.
 */
export function PublicFooter(): JSX.Element {
  return (
    <footer className="border-t border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <Link to="/" className="flex items-center gap-2">
              <BrandMark label={null} className="h-8 w-8" />
              <span className="font-display text-lg font-bold text-content dark:text-content-dark">
                Rota<span className="text-primary-ink">Flow</span>
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-content-muted dark:text-content-muted-dark">
              {TAGLINE}
            </p>
          </div>

          {FOOTER_COLUMNS.map(({ heading, links }) => (
            <nav key={heading} aria-label={heading}>
              <h2 className="mb-3 text-sm font-semibold text-content dark:text-content-dark">
                {heading}
              </h2>
              <ul className="space-y-2.5">
                {links.map(({ label, to }) => (
                  <li key={`${heading}-${label}`}>
                    <Link
                      to={to}
                      className="rounded text-sm text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:text-content-dark"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-surface-border pt-6 sm:flex-row sm:items-center sm:justify-between dark:border-surface-border-dark">
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            &copy; {new Date().getFullYear()} RotaFlow. Built in the UK.
          </p>
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            RotaFlow is in active development. See{' '}
            <Link
              to="/resources"
              className="rounded underline underline-offset-2 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:text-content-dark"
            >
              what is built today
            </Link>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
