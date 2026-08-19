import { LegalNotice } from '@/pages/legal/LegalNotice';

/** `/legal/terms`. See `LegalNotice` for why this is a placeholder. */
export function TermsPage(): JSX.Element {
  return (
    <LegalNotice
      title="Terms of Service"
      eyebrow="Legal"
      summary="The terms that govern use of RotaFlow, for both the organisations that subscribe and the staff they invite."
    />
  );
}
