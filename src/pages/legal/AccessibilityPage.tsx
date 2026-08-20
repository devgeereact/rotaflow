import { LegalNotice } from '@/pages/legal/LegalNotice';

/** `/legal/accessibility`. See `LegalNotice` for why this is a placeholder. */
export function AccessibilityPage(): JSX.Element {
  return (
    <LegalNotice
      title="Accessibility Statement"
      eyebrow="Legal"
      summary="RotaFlow's current accessibility conformance, known limitations and how to report a barrier."
    />
  );
}
