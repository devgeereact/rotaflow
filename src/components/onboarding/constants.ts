/** Shared option lists for the onboarding wizard. */

/** Target sectors from the product brief; `other` keeps the list honest. */
export const INDUSTRIES = [
  'Care home / residential care',
  'Domiciliary care',
  'NHS / healthcare',
  'Hospitality',
  'Retail',
  'Warehousing & logistics',
  'Manufacturing',
  'Security',
  'Cleaning',
  'Education',
  'Places of worship',
  'Events',
  'Professional services',
  'Other',
] as const;

export const ORG_TYPES = [
  'Private company',
  'Public sector',
  'Charity / non-profit',
  'Franchise',
  'Sole trader',
  'Other',
] as const;

export const ORG_SIZES = [
  { value: '1-25', label: '1 – 25', hint: 'people' },
  { value: '26-100', label: '26 – 100', hint: 'people' },
  { value: '101-500', label: '101 – 500', hint: 'people' },
  { value: '500+', label: '500+', hint: 'people' },
] as const;

/** UK-first, matching the product's compliance posture. */
export const COUNTRIES = [
  'United Kingdom',
  'Ireland',
  'United States',
  'Canada',
  'Australia',
  'New Zealand',
  'Other',
] as const;

export const TIMEZONES = [
  { value: 'Europe/London', label: '(GMT+00:00) London' },
  { value: 'Europe/Dublin', label: '(GMT+00:00) Dublin' },
  { value: 'Europe/Paris', label: '(GMT+01:00) Paris' },
  { value: 'America/New_York', label: '(GMT-05:00) New York' },
  { value: 'America/Chicago', label: '(GMT-06:00) Chicago' },
  { value: 'America/Los_Angeles', label: '(GMT-08:00) Los Angeles' },
  { value: 'Australia/Sydney', label: '(GMT+11:00) Sydney' },
] as const;

export const WORKING_WEEKS = [
  { value: 'mon-sun', label: 'Monday – Sunday' },
  { value: 'mon-fri', label: 'Monday – Friday' },
  { value: 'sun-sat', label: 'Sunday – Saturday' },
  { value: 'sat-fri', label: 'Saturday – Friday' },
] as const;

export type BillingPeriod = 'monthly' | 'yearly';

export interface PlanOption {
  /** Matches the `plan` check constraint on `organisations`, or null for enquiry-only. */
  value: 'starter' | 'professional' | 'business' | null;
  name: string;
  tagline: string;
  monthly: number | null;
  staffLimit: string;
  features: string[];
  popular?: boolean;
}

/**
 * Yearly is billed as ten months — "save 2 months" in the design.
 * No charge is taken anywhere: selecting a plan only sets a column. Billing is
 * the final phase of the roadmap (PRD §5, Phase 2 — subscription billing).
 */
export const PLANS: PlanOption[] = [
  {
    value: 'starter',
    name: 'Starter',
    tagline: 'Perfect for small teams getting organised.',
    monthly: 19,
    staffLimit: 'Up to 25 staff',
    features: ['Rota builder', 'Basic reports', 'Leave management', 'Email support'],
  },
  {
    value: 'professional',
    name: 'Professional',
    tagline: 'Everything growing teams need to succeed.',
    monthly: 59,
    staffLimit: 'Up to 100 staff',
    features: [
      'Everything in Starter',
      'Advanced reports',
      'Availability management',
      'Swap management',
      'Priority email support',
    ],
    popular: true,
  },
  {
    value: 'business',
    name: 'Business',
    tagline: 'Advanced features for larger organisations.',
    monthly: 129,
    staffLimit: 'Up to 250 staff',
    features: [
      'Everything in Professional',
      'Advanced analytics',
      'Overtime management',
      'Multiple locations',
      'Phone & email support',
    ],
  },
  {
    value: null,
    name: 'Enterprise',
    tagline: 'For organisations with complex requirements.',
    monthly: null,
    staffLimit: '250+ staff',
    features: [
      'Everything in Business',
      'Custom integrations',
      'Dedicated account manager',
      'SLA & uptime guarantee',
      'Priority support',
    ],
  },
];
