import { Callout } from '@/components/ui/Callout';
import type { NoticeSection } from '@/lib/privacyNotice';

const STATUS_LABEL = {
  'owner-input': 'Needs a decision from RotaFlow',
  'legal-review': 'Needs a solicitor',
} as const;

/**
 * Renders a legal notice from its sections, including the parts that are not
 * finished.
 *
 * The unfinished parts are shown in place rather than collected into an
 * appendix nobody reads. A notice that quietly omits the question of its own
 * lawful basis reads as complete; one that says "this paragraph needs a
 * solicitor, and here is exactly why" tells the reader what they are actually
 * looking at, and tells whoever has to finish it what is left.
 */
export function NoticeSections({
  sections,
}: {
  sections: readonly NoticeSection[];
}): JSX.Element {
  return (
    <div className="space-y-10">
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`notice-${section.id}`}>
          <h2
            id={`notice-${section.id}`}
            className="font-display text-xl font-bold text-content dark:text-content-dark"
          >
            {section.heading}
          </h2>

          {section.body.map((paragraph) => (
            <p
              key={paragraph.slice(0, 48)}
              className="mt-3 leading-relaxed text-content-muted dark:text-content-muted-dark"
            >
              {paragraph}
            </p>
          ))}

          {section.points !== undefined && (
            <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-content-muted dark:text-content-muted-dark">
              {section.points.map((point) => (
                <li key={point.slice(0, 48)}>{point}</li>
              ))}
            </ul>
          )}

          {section.status !== undefined && section.outstanding !== undefined && (
            <Callout tone="warning" title={STATUS_LABEL[section.status]} className="mt-4">
              <p>{section.outstanding}</p>
            </Callout>
          )}

          {section.evidence !== undefined && (
            <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
              Checkable in: <span className="font-mono text-xs">{section.evidence}</span>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
