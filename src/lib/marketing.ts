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

/**
 * Every word of copy on the public marketing site, in one place.
 *
 * ## The rule this file exists to enforce
 *
 * RotaFlow is pre-launch. It has **no customers**, so it has no user counts, no
 * organisation counts, no uptime record and no testimonials. This site is live
 * at rota.gakinz.com and is read by real prospective buyers.
 *
 * Publishing invented traction ("10,000+ active users", "500+ organisations",
 * "99.9% uptime") or a testimonial attributed to a named person at a named
 * company would be a false factual claim to those buyers. Under the UK CAP Code
 * that is a straightforward breach, and it is the kind of claim a competitor or
 * the ASA can act on. `docs/audit01.md` §4 reached the same conclusion
 * independently: _"do not fabricate testimonials or logos"_.
 *
 * So the sections a SaaS landing page normally fills with social proof are
 * built, designed and wired here, and populated with claims that are **true
 * today and checkable against the repository**. The moment real figures exist,
 * fill `TRACTION` and `TESTIMONIALS`: both render automatically, and nothing
 * else has to change.
 *
 * Adding an entry to `PRODUCT_BENEFITS` follows the same rule the feature grid
 * already states. Check it against `docs/SCREENS.md` first. A marketing page
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

export const TAGLINE = 'Smarter Rota. Stronger Teams.';

/**
 * Where `/contact` sends enquiries.
 *
 * ⚠️ **This mailbox must exist and be monitored before launch.** The contact
 * form composes a message to it; if nothing delivers here, every enquiry the
 * site generates is lost silently, which is worse than having no form.
 *
 * A personal address is deliberately not used. Publishing one on a live
 * marketing site is a privacy decision for the owner, not a default. Set up
 * `info@` as an alias in cPanel (or change this constant) as part of launch.
 */
export const CONTACT_EMAIL = 'info@rota.gakinz.com';

export const HERO = {
  headline: ['Smart Schedules.', 'Stronger Teams.', 'Better Business.'],
  body:
    'RotaFlow brings scheduling, staff management, attendance, leave, shift swaps, ' +
    'reporting and workforce operations together in one easy-to-use platform.',
  /**
   * The three trust points under the hero CTAs. These are product facts, not
   * marketing claims: there is genuinely no card capture anywhere in the signup
   * flow (`/signup` collects name, email, org and password. Nothing else) and
   * no billing provider is integrated, so nothing can charge anyone.
   */
  trust: ['14-day free trial', 'No credit card required', 'Cancel anytime'],
} as const;

export interface Benefit {
  icon: LucideIcon;
  title: string;
  body: string;
}

/**
 * The eight product benefits, each mapping to a screen that is built and
 * working today. Verified against `docs/SCREENS.md` §2, not against the PRD's
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
    body: 'One directory for every person across every site. Roles, departments, contracted hours, qualifications, documents and emergency contacts.',
  },
  {
    icon: Clock3,
    title: 'Time and attendance',
    body: 'Clock in and out with GPS verification. No signal on the ward or the shop floor? The entry queues on the device and syncs itself when the connection returns.',
  },
  {
    icon: Repeat2,
    title: 'Leave and shift swaps',
    body: 'Staff request leave and swap shifts from their phone. Managers approve in one place and the rota updates itself, so nobody re-keys anything.',
  },
  {
    icon: Sparkles,
    title: 'AI-assisted rota building',
    body: 'Describe the cover you need in plain language and get a first-pass rota to review and adjust. It proposes; you decide.',
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
    body: 'Cover every floor around the clock without breaching rest rules or running a shift short.',
    points: [
      'Night, early and late cover across floors',
      'Qualification and DBS expiry visible on the rota',
      'Minimum rest periods enforced between shifts',
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
    body: 'Schedule several stores from one place and keep every one covered at peak.',
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
    body: 'Move mobile teams between contracts and keep every site staffed to its requirement.',
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
 * numbers would be invented. `StatsBand` renders `CAPABILITIES` instead while
 * this is empty, and switches to traction the moment it is filled.
 *
 * When filling it: each figure needs a source you could show an auditor.
 * "Active users" means users active in a stated window, counted by a stated
 * query. "Uptime" means measured by a named monitor over a stated period.
 */
export const TRACTION: readonly Stat[] = [] as const;

/**
 * What the stats band shows until real traction exists. Every figure here is a
 * property of the shipped product and is checkable against the repository,
 * they are capability claims, not performance claims.
 */
export const CAPABILITIES: readonly Stat[] = [
  {
    value: '6',
    label: 'Sectors supported',
    detail: 'Healthcare, hospitality, retail, education, security and facilities.',
  },
  {
    value: 'Offline',
    label: 'Clock-in that still works',
    detail: 'Attendance queues on the device with no signal and syncs on reconnect.',
  },
  {
    value: 'Multi-site',
    label: 'Locations per organisation',
    detail: 'Each with its own departments, operating hours and timezone.',
  },
  {
    value: 'UK',
    label: 'Built for UK employment',
    detail: 'UK dates, terminology, working-time rest rules and GDPR obligations.',
  },
] as const;

export interface Reason {
  title: string;
  body: string;
}

export const WHY_ROTAFLOW: readonly Reason[] = [
  {
    title: 'Save time every week',
    body: 'Copy last week forward, auto-fill the gaps, and publish. What took an afternoon in a spreadsheet takes minutes.',
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
    title: 'Maintain compliance',
    body: 'Rest periods, contracted hours, qualification expiry and an auditable attendance record. Visible before they become a problem.',
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
 * No payment provider is integrated, `subscriptions` is an empty seam and
 * `docs/SCREENS.md` §3 records that nothing reads or writes it. So every plan
 * routes to `/signup`, and the page says plainly that billing is not live
 * rather than implying a card will be charged at the end of a trial.
 */
export const PLANS: readonly Plan[] = [
  {
    name: 'Starter',
    price: 'Free',
    cadence: 'during the beta',
    summary: 'For a single site getting off spreadsheets.',
    features: [
      'One location',
      'Up to 25 staff',
      'Rota builder and published schedules',
      'Leave requests and shift swaps',
      'GPS clock-in with offline queue',
      'CSV export',
    ],
    cta: 'Start free',
  },
  {
    name: 'Team',
    price: '£2.50',
    cadence: 'per staff member / month',
    summary: 'For growing organisations running more than one site.',
    features: [
      'Everything in Starter',
      'Unlimited locations and departments',
      'Availability collection',
      'Timesheets and payroll export',
      'Reports across every site',
      'Announcements',
      'Email support',
    ],
    cta: 'Start free trial',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Let us talk',
    cadence: 'annual agreement',
    summary: 'For multi-site groups with compliance and integration needs.',
    features: [
      'Everything in Team',
      'Custom role labels and permissions',
      'Audit trail and retention policy',
      'SSO with Microsoft 365 or Google',
      'Payroll and HR integrations',
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
      { label: 'Start free trial', to: '/signup' },
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
      { label: 'Getting started', to: '/resources' },
      { label: 'Product updates', to: '/resources' },
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
] as const;
