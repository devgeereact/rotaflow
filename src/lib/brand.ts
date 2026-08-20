/**
 * Product identity used wherever RotaFlow speaks about itself publicly.
 *
 * This is intentionally separate from tenant names: an organisation can name
 * its workspace anything it needs, while this identity remains the platform
 * that schedules its workforce. Claims here are limited to functionality that
 * exists in the shipped product; see docs/BRAND.md for the evidence standard.
 */
export const BRAND = {
  name: 'RotaFlow',
  shortName: 'RotaFlow',
  tagline: 'Scheduling certainty for every shift.',
  description:
    'UK-first workforce scheduling for shift-based teams. Build rotas, manage leave and swaps, track attendance and keep working when the signal drops.',
  positioning:
    'An offline-first workforce scheduling platform for UK organisations that need dependable cover across sites, teams and shift patterns.',
  audience: 'Scheduling managers and frontline teams in UK shift-based organisations.',
} as const;

export const BRAND_CLAIM_GUARDRAILS = {
  isPreLaunch: true,
  hasPublicTraction: false,
  hasLiveBilling: false,
} as const;
