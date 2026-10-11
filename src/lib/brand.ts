/**
 * Product identity used wherever RotaFlow speaks about itself publicly.
 *
 * This is intentionally separate from tenant names: an organisation can name
 * its workspace anything it needs, while this identity remains the platform
 * that schedules its workforce. Claims here are limited to functionality that
 * exists in the shipped product; see docs/DESIGN-SYSTEM.md#brand-and-voice for the evidence standard.
 */
export const BRAND = {
  name: 'RotaFlow',
  shortName: 'RotaFlow',
  tagline: 'Scheduling certainty for every shift.',
  description:
    'Plan and publish rotas, handle leave and swaps, and see who has clocked in. Clock-ins, leave and swap requests wait on the phone until the signal returns.',
  positioning:
    'An offline-first workforce scheduling platform for UK organisations that need dependable cover across sites, teams and shift patterns.',
  audience: 'Scheduling managers and frontline teams in UK shift-based organisations.',
} as const;

export const BRAND_CLAIM_GUARDRAILS = {
  isPreLaunch: true,
  hasPublicTraction: false,
  // Stripe Checkout, the Billing Portal and the webhook all ship. No consumer
  // reads this flag today; it records the fact for whoever adds one.
  hasLiveBilling: true,
} as const;
