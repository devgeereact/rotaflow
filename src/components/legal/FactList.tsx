import { Card } from '@/components/ui/Card';
import type { DataFact } from '@/lib/legalFacts';

interface FactListProps {
  facts: readonly DataFact[];
}

/**
 * A legal page written as questions somebody actually asks (CAP-060).
 *
 * The four legal routes used to render a placeholder saying the real text was
 * coming. Honest on day one, misleading by month three: a live public site
 * whose Privacy page says "this is a placeholder" reads as "nobody has
 * thought about this", which is worse than the short accurate statement that
 * could have been written from what the code does.
 *
 * `<dl>` rather than headings and paragraphs, because that is what this is —
 * a question and its answer — and a screen reader announces the pairing.
 */
export function FactList({ facts }: FactListProps): JSX.Element {
  return (
    <dl className="space-y-5">
      {facts.map((fact) => (
        <Card key={fact.question}>
          <dt className="font-semibold text-content dark:text-content-dark">
            {fact.question}
          </dt>
          <dd className="mt-2 leading-relaxed text-content-muted dark:text-content-muted-dark">
            {fact.answer}
          </dd>
        </Card>
      ))}
    </dl>
  );
}
