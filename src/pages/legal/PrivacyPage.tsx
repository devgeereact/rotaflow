import { LegalNotice } from '@/pages/legal/LegalNotice';

/** `/legal/privacy`. See `LegalNotice` for why this is a placeholder. */
export function PrivacyPage(): JSX.Element {
  return (
    <LegalNotice
      title="Privacy Notice"
      eyebrow="Legal"
      summary="How RotaFlow collects, stores and processes personal data — staff, managers and site visitors."
    />
  );
}
