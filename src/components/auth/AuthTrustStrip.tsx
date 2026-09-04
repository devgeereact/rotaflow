import { Lock, MapPin } from 'lucide-react';

const CLAIMS = [
  { icon: MapPin, label: 'Data held in the EU' },
  { icon: Lock, label: 'Tenant isolation in the database' },
];

/**
 * The trust-badge row under the auth card (docs/design/signup.png,
 * docs/design/signin.png).
 *
 * The reference shows three badges. "99.9% uptime" was dropped when this was
 * built, because no SLA has been committed to, and the file said so.
 *
 * The other two were kept on the reasoning that they "describe the actual
 * architecture". One of them did not. **"GDPR compliant" is not a description
 * of an architecture, it is a compliance claim**, and it is the exact claim
 * `src/lib/marketing.ts` records as having been deleted from the adjacent
 * feature list for being unverifiable, under a rule `docs/BRAND.md` states
 * outright: do not promise compliance. It sat on /login and /signup for weeks
 * while the same words were forbidden one file away — and at the same time the
 * app was running session replay against a Cookie Notice that said there was
 * no tracking, which is the sort of thing that makes a compliance badge worse
 * than no badge.
 *
 * What replaces it is checkable. The database is in eu-west-1
 * (`src/lib/subprocessors.ts`), and tenants are separated by row-level
 * security rather than by an application filter (`docs/SCHEMA.md` §5). Both
 * are facts a reader could falsify, which is the whole point.
 */
export function AuthTrustStrip(): JSX.Element {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 pb-4 pt-3">
      {CLAIMS.map(({ icon: Icon, label }) => (
        <li
          key={label}
          className="flex items-center gap-2 text-sm text-content-muted dark:text-content-muted-dark"
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
