import { LegalNotice } from '@/pages/legal/LegalNotice';

/**
 * `/legal/terms`.
 *
 * The one legal route still using the placeholder shell, and correctly. The
 * other three describe what the software does and were written from the
 * code (CAP-060); a contract says what we owe a customer when something goes
 * wrong, which cannot be derived from a codebase. Inventing it would be
 * worse than saying it is not written.
 */
export function TermsPage(): JSX.Element {
  return (
    <LegalNotice
      title="Terms of Service"
      eyebrow="Legal"
      summary="The terms that govern use of RotaFlow, for both the organisations that subscribe and the staff they invite."
    />
  );
}
