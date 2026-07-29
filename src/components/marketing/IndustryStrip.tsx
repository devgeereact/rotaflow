/**
 * Target industries, verbatim from docs/PRD.md §"Positioning" — the sectors
 * RotaFlow is designed for, not a claim that organisations in them are already
 * customers. No logos, no customer names: none exist yet to show honestly.
 */
const INDUSTRIES = [
  'Care homes',
  'NHS / agency',
  'Domiciliary care',
  'Hospitality',
  'Retail',
  'Warehousing & logistics',
  'Manufacturing',
  'Security',
  'Cleaning',
  'Education',
  'Places of worship',
  'Events',
  'Logistics',
  'Offices',
];

export function IndustryStrip(): JSX.Element {
  return (
    <section className="border-y border-surface-border bg-surface-subtle py-12 dark:border-surface-border-dark dark:bg-surface-subtle-dark">
      <div className="mx-auto max-w-6xl px-6">
        <p className="mb-5 text-center text-sm font-medium uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
          Built for teams with shift-based rotas
        </p>
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-2">
          {INDUSTRIES.map((industry) => (
            <li
              key={industry}
              className="rounded-full border border-surface-border bg-surface px-3.5 py-1.5 text-sm text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
            >
              {industry}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
