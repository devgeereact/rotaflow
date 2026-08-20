import { LegalNotice } from '@/pages/legal/LegalNotice';

/** `/legal/cookies`. See `LegalNotice` for why this is a placeholder. */
export function CookiesPage(): JSX.Element {
  return (
    <LegalNotice
      title="Cookie Notice"
      eyebrow="Legal"
      summary="What RotaFlow stores in the browser, why, and the choices available to you."
    />
  );
}
