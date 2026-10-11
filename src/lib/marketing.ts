import {
  BarChart3,
  CalendarDays,
  Clock3,
  Download,
  GraduationCap,
  Hotel,
  MapPinned,
  Repeat2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { BRAND } from '@/lib/brand';

/**
 * Every word of copy on the public marketing site, in one place.
 *
 * ## The rule this file exists to enforce
 *
 * RotaFlow is pre-launch. It has **no customers**, so it has no user counts, no
 * organisation counts, no uptime record and no testimonials. This site is live
 * at rotaflow.space and is read by real prospective buyers.
 *
 * Publishing invented traction ("10,000+ active users", "500+ organisations",
 * "99.9% uptime") or a testimonial attributed to a named person at a named
 * company would be a false factual claim to those buyers. Under the UK CAP Code
 * that is a straightforward breach, and it is the kind of claim a competitor or
 * the ASA can act on. `docs/SAAS.md` reached the same conclusion
 * independently: _"do not fabricate testimonials or logos"_.
 *
 * So the sections a SaaS landing page normally fills with social proof are
 * built, designed and wired here, and populated with claims that are **true
 * today and checkable against the repository**. The moment real figures exist,
 * fill `TRACTION` and `TESTIMONIALS`: both render automatically, and nothing
 * else has to change.
 *
 * Adding an entry to `PRODUCT_BENEFITS` follows the same rule the feature grid
 * already states. Check it against `docs/UX-SPEC.md` first. A marketing page
 * for a real product must not advertise ahead of the build.
 */

export interface NavLinkSpec {
  label: string;
  to: string;
}

/** Primary marketing nav, in the order the design shows it. */
export const MARKETING_NAV: readonly NavLinkSpec[] = [
  { label: 'Features', to: '/features' },
  { label: 'Solutions', to: '/solutions' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Resources', to: '/resources' },
  { label: 'Contact', to: '/contact' },
] as const;

export const TAGLINE = BRAND.tagline;
export const PRIMARY_CTA = 'Join the beta';

/**
 * Where `/contact` sends enquiries.
 *
 * On `rotaflow.space` as of 2026-08-29, the product's own domain. Two earlier
 * addresses failed in ways worth not repeating:
 *
 *   - An address on the old subdomain (until 2026-08-13) was undeliverable
 *     INBOUND. That subdomain carried SPF and DKIM but had no MX at all, so it
 *     could sign outbound mail and silently drop every reply. Note the failure
 *     was the missing MX specifically, not "no mail records" — the distinction
 *     matters when diagnosing the next one.
 *   - `info@gakinz.com` (2026-08-13 to 2026-08-29) delivered correctly, but
 *     it is the operator's own address, not the product's.
 *
 * `rotaflow.space` has the full standard record set — MX ×3, one SPF, one
 * DKIM, one DMARC — verified in Cloudflare before this switch. Confirm any
 * future change actually DELIVERS, not merely resolves.
 */
export const CONTACT_EMAIL = 'support@rotaflow.space';

export const HERO = {
  eyebrow: 'UK-first workforce scheduling',
  /**
   * One line, not three. The previous three-line headline ended "Even
   * offline.", which overclaimed: only clock-ins, leave requests and swap
   * requests queue on the device without a signal
   * (docs/ARCHITECTURE.md#offline-and-pwa).
   */
  headline: 'Rotas your team can actually follow.',
  body: 'Plan and publish shifts across your sites, handle leave and swap requests in one place, and see who has clocked in, from any phone.',
  /**
   * The three trust points under the hero CTAs. These are product facts
   * reflecting what happens at signup: no card capture in the signup flow
   * (`/signup` collects name, email, org and password. Nothing else), and
   * payment setup happens later in Settings > Billing after an org exists.
   */
  trust: ['Early access beta', 'No credit card required', 'No payment setup'],
} as const;

export interface Benefit {
  icon: LucideIcon;
  title: string;
  body: string;
}

/**
 * The eight product benefits, each mapping to a screen that is built and
 * working today. Verified against `docs/UX-SPEC.md` §2, not against the PRD's
 * full Phase-1 wish list.
 */
export const PRODUCT_BENEFITS: readonly Benefit[] = [
  {
    icon: CalendarDays,
    title: 'Smart scheduling',
    body: 'Build a week on a staff-by-day grid, drag shifts into place, and publish when it is ready. Conflicts, rest breaches and unavailability are flagged as you build, not after.',
  },
  {
    icon: Users,
    title: 'Staff management',
    body: 'One directory for every person across every site. Roles, departments, contracted hours, qualifications, document links and emergency contacts.',
  },
  {
    icon: Clock3,
    title: 'Time and attendance',
    body: 'Clock in and out with GPS verification. No signal on the ward or the shop floor? The clock-in waits on the phone and sends when the signal returns.',
  },
  {
    icon: Repeat2,
    title: 'Leave and shift swaps',
    body: 'Staff request leave and swap shifts from their phone. Managers approve in one place and the rota updates itself, so nobody re-keys anything.',
  },
  {
    icon: Sparkles,
    title: 'AI-assisted rota building',
    // The plan note mirrors the `ai_rota_assistant` entitlement, granted to
    // Business and Enterprise only (supabase/migrations/0030, line 41) and
    // enforced server-side (0074). Change both together or neither.
    body: 'Describe the cover you need in plain language and get a first-pass rota to review and adjust. It proposes; you decide. Available on the Business and Enterprise plans.',
  },
  {
    icon: BarChart3,
    title: 'Reporting and insights',
    body: 'Coverage, labour hours, attendance, absence and overtime. Filtered by site and department, exportable for payroll.',
  },
  {
    icon: MapPinned,
    title: 'Multi-location management',
    body: 'Run several sites from one organisation, each with its own departments, operating hours, staffing requirements and timezone.',
  },
  {
    icon: Download,
    title: 'Exports and calendar sync',
    body: 'Export any table to CSV, and let staff subscribe to their own schedule from Apple Calendar, Google Calendar or Outlook.',
  },
] as const;

/**
 * The four-item feature list beside the Login and Signup forms
 * (`AuthSplitLayout`). Was hardcoded identically in both pages until it was
 * found here, still claiming "Compliant & Secure — Stay compliant with
 * confidence": an unsubstantiated compliance claim on a public,
 * unauthenticated page, exactly what `docs/DESIGN-SYSTEM.md#brand-and-voice`'s evidence boundary and
 * the transformation plan's legal guardrail both forbid. These four instead
 * name what the product actually does, matching `PRODUCT_BENEFITS`' standard.
 */
export const AUTH_FEATURES: readonly Benefit[] = [
  {
    icon: CalendarDays,
    title: 'Rota building',
    body: 'Build a week on a staff-by-day grid, with conflicts and rest breaches flagged before you publish.',
  },
  {
    icon: Users,
    title: 'Staff management',
    body: 'One directory for every person, role and department across every site.',
  },
  {
    icon: ShieldCheck,
    title: 'Tenant-isolated data',
    body: "Every organisation's data is separated at the database level by row-level security, not an application-code filter.",
  },
  {
    icon: BarChart3,
    title: 'Reporting',
    body: 'Coverage, hours, attendance and overtime, filtered by site and exportable for payroll.',
  },
] as const;

export interface Sector {
  icon: LucideIcon;
  name: string;
  body: string;
  /** Concrete scheduling problems this sector actually has. */
  points: readonly string[];
}

export const SECTORS: readonly Sector[] = [
  {
    icon: Stethoscope,
    name: 'Healthcare and care homes',
    body: 'Plan cover for every floor around the clock, with rest-rule warnings and gaps shown before you publish.',
    points: [
      'Night, early and late cover across floors',
      'Qualification and DBS expiry visible on the rota',
      'Minimum rest warnings between shifts',
    ],
  },
  {
    icon: Hotel,
    name: 'Hospitality',
    body: 'Flex the rota against covers and trade, and fill a dropped shift before service starts.',
    points: [
      'Split shifts and variable weekly hours',
      'Open shifts staff can pick up',
      'Labour hours tracked against the week',
    ],
  },
  {
    icon: ShoppingBag,
    name: 'Retail',
    body: 'Schedule several stores from one place and see the gaps at peak before you publish.',
    points: [
      'Multi-store rotas from a single organisation',
      'Availability collected before the rota is built',
      'Coverage gaps flagged before publishing',
    ],
  },
  {
    icon: GraduationCap,
    name: 'Education',
    body: 'Plan term-time cover, supervision duties and support staff in one shared schedule.',
    points: [
      'Term-time and holiday patterns',
      'Cover for absence at short notice',
      'Departments with their own managers',
    ],
  },
  {
    icon: ShieldCheck,
    name: 'Security',
    body: 'Prove who was on site and when, with location-verified clock-ins.',
    points: [
      'GPS-verified attendance per site',
      'Continuous 24/7 shift patterns',
      'Auditable attendance history',
    ],
  },
  {
    icon: Wrench,
    name: 'Facilities management',
    body: 'Move mobile teams between contracts and check each site against its staffing requirement.',
    points: [
      'Staff shared across multiple sites',
      'Per-site staffing requirements',
      'Timesheets built from real clock events',
    ],
  },
] as const;

export interface Stat {
  value: string;
  label: string;
  detail: string;
}

/**
 * Traction figures. User counts, organisation counts, uptime.
 *
 * **Deliberately empty.** RotaFlow has not launched, so every one of these
 * numbers would be invented. `StatsBand` renders nothing while this is empty
 * and appears on the homepage the moment it is filled. The capability band
 * that used to stand in for it ("Offline", "Multi-site", "UK") was removed on
 * 2026-10-11: it looked like a stats band with no numbers in it.
 *
 * When filling it: each figure needs a source you could show an auditor.
 * "Active users" means users active in a stated window, counted by a stated
 * query. "Uptime" means measured by a named monitor over a stated period.
 */
export const TRACTION: readonly Stat[] = [] as const;

export interface Reason {
  title: string;
  body: string;
}

export const WHY_ROTAFLOW: readonly Reason[] = [
  {
    // No time saving is quoted here: none has been measured
    // (docs/DESIGN-SYSTEM.md#brand-and-voice, evidence boundary). Add a figure only once the pilot has measured one.
    title: 'See gaps before you publish',
    body: 'Copy last week forward, auto-fill the gaps, and check coverage per day and department before the rota goes out.',
  },
  {
    title: 'Reduce scheduling errors',
    body: 'Double-bookings, rest-period breaches and unavailable staff are caught while you build the rota, not after someone misses a shift.',
  },
  {
    title: 'Improve staff communication',
    body: 'Published rotas, announcements and swap responses reach everyone in one place, instead of a WhatsApp group and a printed notice board.',
  },
  {
    // Not "compliance": the rota warns, it does not certify. "Rest-period",
    // not "rest-break": the check is the 11-hour gap between shifts
    // (`rotaInsights.ts`, rest_breach); nothing checks breaks within a shift.
    // The 48-hour figure is the week total the rota grid turns red
    // (`RotaGridRow.tsx`, STATUTORY_WEEKLY_MINUTES).
    title: 'Rest-period and 48-hour warnings',
    body: 'Rest-period and 48-hour warnings on the rota, qualification expiry in view, and a record of every clock-in.',
  },
  {
    title: 'Increase workforce visibility',
    body: 'Coverage, labour hours and absence across every site, in one view, updated live as things change.',
  },
] as const;

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  organisation: string;
}

/**
 * **Deliberately empty**. See this file's header. RotaFlow has no customers,
 * so it has no testimonials, and attributing an invented quote to a named
 * person at a named company is the single most actionable false claim a
 * pre-launch SaaS site can make.
 *
 * `TestimonialBand` renders nothing while this is empty. Add entries only with
 * the named person's written permission to be quoted.
 */
export const TESTIMONIALS: readonly Testimonial[] = [] as const;

export interface Plan {
  name: string;
  price: string;
  cadence: string;
  summary: string;
  features: readonly string[];
  cta: string;
  featured?: boolean;
}

/**
 * Pricing.
 *
 * Mirrors supabase/migrations/0023_commercials.sql's seeded `plans` rows
 * exactly — that table, not this array, is what checkout actually charges.
 * If these ever disagree, the migration is right and this needs updating,
 * not the other way round. Not fetched at runtime: this page is
 * unauthenticated and `plans`' RLS requires a signed-in user (0023).
 */
export const PLANS: readonly Plan[] = [
  {
    name: 'Starter',
    price: '£29',
    cadence: 'per month',
    summary: 'One site, up to 15 staff.',
    features: [
      'One location',
      'Up to 15 staff',
      'Rota builder and published schedules',
      'Leave requests and shift swaps',
      'GPS clock-in with offline queue',
      'CSV export',
    ],
    cta: PRIMARY_CTA,
  },
  {
    name: 'Professional',
    price: '£129',
    cadence: 'per month',
    summary: 'Up to five sites and 60 staff.',
    features: [
      'Everything in Starter',
      'Up to five locations',
      'Up to 60 staff',
      'Availability collection',
      'Timesheets and payroll export',
      'Reports across every site',
      'Announcements',
    ],
    cta: PRIMARY_CTA,
    featured: true,
  },
  {
    name: 'Business',
    price: '£299',
    cadence: 'per month',
    summary: 'Up to twenty sites and 200 staff.',
    features: [
      'Everything in Professional',
      'Up to twenty locations',
      'Up to 200 staff',
      'Custom role labels and permissions',
      'Audit trail and retention policy',
      'Email support',
    ],
    cta: PRIMARY_CTA,
  },
  {
    name: 'Enterprise',
    price: '£790',
    cadence: 'per month',
    // Two bullets were removed on 2026-08-31: 'SSO with Microsoft 365 or
    // Google' and 'Payroll and HR integrations'. Neither exists — there is no
    // `supabase.auth.mfa` or SAML call anywhere in the product, and the whole
    // of the payroll story is a `payroll_id` column and a timesheet CSV. This
    // is a public page selling a £790/month plan; a bullet nobody can deliver
    // is a promise made to somebody spending real money, and the fact that
    // Enterprise is Contact-us rather than self-serve makes it worse, not
    // better: it is the bullet the sales conversation opens on. Both are on
    // the roadmap (CAP-068, CAP-067) and neither is sold until it is built.
    summary: 'Unlimited sites and staff, with hands-on onboarding.',
    features: [
      'Everything in Business',
      'Unlimited locations and staff',
      'Timesheet export shaped for your payroll provider',
      'Onboarding and migration support',
    ],
    cta: 'Contact us',
  },
] as const;

export interface FooterColumn {
  heading: string;
  links: readonly NavLinkSpec[];
}

/**
 * Footer columns. Every link resolves to a real route, `navigationTargets`
 * asserts it. The previous footer deliberately carried no social or contact
 * row because none existed; `/contact` now does, so it is linked, and the
 * social row is still absent for the same reason as before.
 */
export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', to: '/features' },
      { label: 'Pricing', to: '/pricing' },
      { label: PRIMARY_CTA, to: '/signup' },
      { label: 'Sign in', to: '/login' },
    ],
  },
  {
    heading: 'Solutions',
    links: [
      { label: 'Healthcare and care', to: '/solutions' },
      { label: 'Hospitality', to: '/solutions' },
      { label: 'Retail', to: '/solutions' },
      { label: 'Security', to: '/solutions' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Getting started', to: '/resources#getting-started' },
      { label: 'Product updates', to: '/resources#product-updates' },
      { label: 'Support', to: '/contact' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Contact', to: '/contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy', to: '/legal/privacy' },
      { label: 'Terms', to: '/legal/terms' },
      { label: 'Cookies', to: '/legal/cookies' },
      { label: 'Accessibility', to: '/legal/accessibility' },
      // The one legal page that is not a placeholder: it is a statement of
      // fact about the system rather than a policy needing counsel, so it is
      // published now (docs/SAAS.md GAP-014).
      { label: 'Trust and sub-processors', to: '/legal/trust' },
    ],
  },
] as const;
