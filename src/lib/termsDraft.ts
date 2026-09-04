import type { NoticeSection } from '@/lib/privacyNotice';

/**
 * A draft Terms of Service (CAP-060).
 *
 * ## Why this exists when the page used to refuse to
 *
 * The placeholder this replaced said, correctly, that a contract is not a
 * description: a
 * privacy notice can be written from the code because it says what the
 * software does, whereas terms say what we owe a customer when something goes
 * wrong, and no amount of reading the repository reveals that.
 *
 * That argument was right about the commercial terms and wrong about the rest.
 * Eligibility, what the plans include, how billing works, what happens when a
 * payment fails, what a customer's data is used for, and how an account is
 * closed are all facts about a system that exists. Roughly two thirds of a
 * terms document is that, and refusing to write any of it left a live public
 * site with an empty Terms page and a Sign up button beside it.
 *
 * So this is drafted, marked, and honest about the seam. Every clause that is
 * a commercial promise rather than a description carries `status` and says
 * what has to be decided. The page renders those warnings in place, and the
 * draft banner is not removable without an edit — nobody should be able to
 * mistake this for a signed contract.
 *
 * **This is not legal advice and not a binding agreement.** It has not been
 * reviewed by a solicitor.
 */
export const TERMS_DRAFTED = '4 September 2026';

export const TERMS_SECTIONS: readonly NoticeSection[] = [
  {
    id: 'who',
    heading: 'Who these terms are with',
    body: [
      'RotaFlow is operated by Gideon Akinlotan, a sole trader established in the United Kingdom, trading as RotaFlow. "We" and "us" mean that person; "you" means the organisation that opens an account, and the people it invites.',
      'The way to reach us about anything here is support@rotaflow.space.',
    ],
    status: 'owner-input',
    outstanding:
      'Whether the service will be operated by a limited company rather than a sole trader affects every clause below, and is worth settling before anything is signed rather than after. There is no registered postal address published and no VAT registration recorded.',
  },
  {
    id: 'eligibility',
    heading: 'Who may use it',
    body: [
      'RotaFlow is sold to organisations, not to individuals for personal use. Whoever opens an account confirms they are authorised to enter into these terms for that organisation.',
      'Individual staff members do not sign these terms. They are invited by their employer, and their use of the product is governed by their relationship with that employer.',
      'There is no minimum age check in the product, and none is claimed here.',
    ],
    status: 'owner-input',
    outstanding:
      'Whether to set a minimum age, and what an employer must confirm about young workers it schedules, is unanswered. See the same item in the Privacy Notice.',
  },
  {
    id: 'accounts',
    heading: 'Accounts and roles',
    body: [
      'An account belongs to an organisation. Within it, there are four levels of access: an owner, managers, staff, and our own platform administrators. What each can do is enforced by the database rather than by the interface, so a hidden button is not the only thing standing between a role and an action it should not take.',
      'You are responsible for who you invite and for what they do with the access you give them. Two-factor authentication is available and we would rather you used it.',
      'One protection is built in and worth naming: an organisation cannot be left without an owner, so the last owner cannot be removed or demoted by accident.',
    ],
    evidence:
      'supabase/migrations/ (memberships_keep_one_owner), src/hooks/usePermissions.ts',
  },
  {
    id: 'acceptable-use',
    heading: 'Acceptable use',
    body: [
      'Use RotaFlow to schedule and manage a workforce. Do not use it to do the following, which is a short list because a long one tends to be read as exhaustive:',
    ],
    points: [
      'Break the law, or help somebody else to.',
      'Upload or link to material you have no right to hold, including personal information about people who have not been told you hold it.',
      'Attempt to reach another organisation’s data, or to test the boundaries between tenants without written permission. If you want to test our security, the disclosure route is published at /legal/trust and we would rather you used it.',
      'Interfere with the service for others, including by automated traffic that is not ordinary use of the product.',
      'Resell or white-label the service without a written agreement.',
    ],
  },
  {
    id: 'what-you-get',
    heading: 'The service, and what it does not promise',
    body: [
      'RotaFlow is provided as it stands and as it develops. Plans and their limits are published on the pricing page and enforced in the database: Starter at £29 a month for one site and up to 15 staff, Professional at £129 for up to five sites and 60 staff, Business at £299, and Enterprise at £790. The AI assistant is included with Business and Enterprise only.',
      'The product is in active development and is described that way throughout the site. Features are added, and occasionally an approach is replaced. Where a change removes something you rely on, we will say so rather than let you find out.',
      'There is no uptime commitment. The site does not claim one anywhere and this document will not invent one: an availability figure nobody has measured or resourced is a promise waiting to be broken.',
    ],
    status: 'owner-input',
    outstanding:
      'Whether to offer a service level at all, and if so what figure and what remedy, is undecided. So is the notice period for a change that removes a feature.',
    evidence: 'src/lib/marketing.ts (PLANS), supabase/migrations/0023_commercials.sql',
  },
  {
    id: 'billing',
    heading: 'Payment, renewal and cancellation',
    body: [
      'Subscriptions are taken through Stripe. Card details are entered on Stripe’s own checkout page and never reach us; we hold the resulting customer reference, the plan and the invoices.',
      'A subscription renews on its own cycle until it is cancelled. Cancellation is through the billing portal, reachable from the organisation’s billing settings, and takes effect at the end of the period already paid for.',
      'When a payment fails, the account is not cut off immediately: there is a fourteen-day grace window during which the service continues and the failure can be put right.',
      'Nothing has been charged yet. RotaFlow has taken no live payment, and this section describes a mechanism that is built and tested rather than one that has been exercised commercially.',
    ],
    status: 'owner-input',
    outstanding:
      'Refunds, pro-rata credit on a mid-period downgrade, what happens to data at the end of the grace window, and whether prices include or exclude VAT are all undecided. The published prices carry no VAT statement, which is the sort of omission that becomes a dispute.',
    evidence:
      'supabase/functions/create-checkout-session, create-portal-session, stripe-webhook, supabase/migrations/0098_subscription_grace_window.sql',
  },
  {
    id: 'your-data',
    heading: 'Your data',
    body: [
      'The information an organisation puts into RotaFlow belongs to that organisation. We hold it to run the service and for nothing else: it is not sold, not used for advertising, and not used to train anybody’s model.',
      'An organisation can export everything it holds as a single file at any time, and can delete itself outright, which removes the data immediately across every table that references it.',
      'How that information is handled, who processes it and for how long is set out in the Privacy Notice and the Trust page rather than repeated here, so the two cannot drift apart.',
    ],
    status: 'legal-review',
    outstanding:
      'A customer processing staff data through RotaFlow needs a data processing agreement under Article 28, and none has been drafted. The sub-processor list exists and is accurate, which is the input such an agreement needs, but the agreement itself is a contract and belongs to a solicitor.',
    evidence: 'src/services/orgLifecycleService.ts, src/lib/subprocessors.ts',
  },
  {
    id: 'ip',
    heading: 'Intellectual property',
    body: [
      'The software, its design and its documentation remain ours. Using the service does not transfer any of that to you.',
      'What you put in remains yours. We claim no rights over your rotas, your staff records or anything else you enter, beyond what is needed to operate the service for you.',
    ],
    status: 'legal-review',
    outstanding:
      'The repository is public and carries a LICENSE file with no named copyright holder. What that licence actually permits, and how it sits alongside this clause, needs checking before either is relied on.',
  },
  {
    id: 'third-parties',
    heading: 'Services we rely on',
    body: [
      'RotaFlow runs on services operated by other people: the database and authentication, payments, error monitoring, image hosting, the mail server and the network in front of the site. They are each named on the Trust page, with what they receive and where they operate.',
      'We choose them and we remain answerable to you for the service, but we do not control their availability. Where one of them fails in a way that affects you, we will tell you what happened.',
    ],
    evidence: 'src/lib/subprocessors.ts',
  },
  {
    id: 'suspension',
    heading: 'Suspension and ending the agreement',
    body: [
      'You can stop at any time by cancelling the subscription, and can delete the organisation whenever you choose. Deletion is immediate and, because there are no backups, it cannot be undone by us or by anybody else. The product asks you to type the organisation’s name before it will proceed, for that reason.',
      'We may suspend an account that is being used in a way that breaks the acceptable use section, or that puts the service or other customers at risk.',
    ],
    status: 'owner-input',
    outstanding:
      'What notice we give before suspending, whether there is a route to appeal, and how long a customer has to export before an account we close is emptied, are all undecided.',
    evidence: 'supabase/migrations/0063_delete_organisation.sql',
  },
  {
    id: 'liability',
    heading: 'Liability',
    body: [
      'This section is deliberately empty of numbers.',
      'A liability cap, an exclusion of indirect loss, and the carve-outs that UK law does not permit a business to exclude at all are the clauses most likely to be tested and the ones least suited to being drafted from a codebase. Nothing is stated here rather than something being stated wrongly.',
    ],
    status: 'legal-review',
    outstanding:
      'The entire section needs drafting by a solicitor: cap, exclusions, the non-excludable carve-outs, and any indemnity. Until it exists, this document should not be presented to a customer as terms they are agreeing to.',
  },
  {
    id: 'law',
    heading: 'Governing law',
    body: [
      'RotaFlow is operated from the United Kingdom and is built for UK employment practice.',
      'Which law governs this agreement and where a dispute would be heard is not stated here, because for a customer in the EEA that is not a free choice and getting it wrong is worse than leaving it open.',
    ],
    status: 'legal-review',
    outstanding:
      'Governing law, jurisdiction and any dispute procedure need to be settled, including how they work for an EEA customer.',
  },
  {
    id: 'changes',
    heading: 'Changes to these terms',
    body: [
      `This draft was written on ${TERMS_DRAFTED}. It is not in force, so there is nothing yet to change.`,
      'When a final version is published, how much notice a change carries will be stated in it.',
    ],
  },
];

/** The clauses that cannot be relied on as written, for the page banner. */
export const TERMS_OUTSTANDING: readonly NoticeSection[] = TERMS_SECTIONS.filter(
  (section) => section.status !== undefined,
);
