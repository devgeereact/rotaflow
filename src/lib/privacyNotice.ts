/**
 * The full privacy notice (CAP-060, extending the six summary facts in
 * `legalFacts.ts`).
 *
 * ## Why this is longer than the summary, and still not finished
 *
 * `PRIVACY_FACTS` answers six questions honestly and remains the first thing
 * on the page. It is not a privacy notice. UK GDPR Article 13 wants the
 * controller named, the purposes given, a lawful basis for each, the retention
 * period, the recipients, the transfers, the rights, and the route to the
 * regulator. None of that was published.
 *
 * Most of it can be written from the repository, because most of it is a
 * description: what is collected, where it goes, how long it survives, who
 * else sees it. Every such statement below cites the file or migration that
 * proves it, on the same rule `subprocessors.ts` sets — a claim a reader
 * cannot check is worth less than an absent one.
 *
 * The rest cannot. A lawful basis is a legal conclusion, not a fact about
 * code; so is the Article 9 condition for holding health information, the
 * transfer mechanism for the two United States processors, and whether a sole
 * trader may publish an email address in place of a postal one. Those sections
 * carry `status` and `outstanding`, the page renders them as unresolved, and
 * nothing here should be published until somebody qualified has read them.
 *
 * **This file is a draft written from the code. It is not legal advice.**
 */

export type NoticeStatus = 'owner-input' | 'legal-review';

export interface NoticeSection {
  id: string;
  heading: string;
  /** Paragraphs, in order. */
  body: readonly string[];
  /** An optional list under the paragraphs. */
  points?: readonly string[];
  /** Present when the section cannot be relied on as written. */
  status?: NoticeStatus;
  /** Exactly what is unsettled, so it can be chased rather than forgotten. */
  outstanding?: string;
  /** Where in the repository the factual claims can be checked. */
  evidence?: string;
}

/** Who operates the service. Confirmed by the owner on 4 September 2026. */
export const OPERATOR = {
  name: 'Gideon Akinlotan',
  form: 'sole trader established in the United Kingdom',
  tradingAs: 'RotaFlow',
} as const;

/**
 * The date this text was written, shown so a reader can judge staleness.
 *
 * It is deliberately not called an effective date. Nothing here takes effect
 * until the outstanding items are settled and the notice is published as
 * final, and stamping it "effective" beforehand would be the kind of
 * borrowed-confidence detail this repository keeps removing from its own
 * marketing copy.
 */
export const PRIVACY_NOTICE_DRAFTED = '4 September 2026';

export const PRIVACY_NOTICE_SECTIONS: readonly NoticeSection[] = [
  {
    id: 'who-we-are',
    heading: 'Who we are, and how to reach us',
    body: [
      `RotaFlow is operated by ${OPERATOR.name}, a ${OPERATOR.form}, trading as ${OPERATOR.tradingAs}. There is no limited company behind it and no company number to quote.`,
      'The way to reach us about anything in this notice, including a request about your own information, is support@rotaflow.space. A postal address is available on request.',
      'There is no data protection officer. The law requires one only in specific cases, and a one-person business scheduling shift workers is unlikely to be one of them, but that is a judgement rather than a certainty and it is on the list below.',
    ],
    status: 'owner-input',
    outstanding:
      'RotaFlow is not registered with the Information Commissioner’s Office and holds no registration number. Most UK organisations processing personal data must register and pay the data protection fee. Registration, and the decision about publishing a postal address rather than offering it on request, both need settling before this notice is published. Whether an Article 27 representative is needed for users in the EEA is unanswered.',
    evidence: 'src/lib/marketing.ts (CONTACT_EMAIL), public/.well-known/security.txt',
  },
  {
    id: 'two-roles',
    heading: 'Two different roles, and which one applies to you',
    body: [
      'RotaFlow does two distinct things with personal information, and your rights differ depending on which one you are asking about.',
      'When an employer uses RotaFlow to schedule its staff, the employer decides what is held and why. They are the controller and we are the processor: we act on their instructions. If you are a member of staff asking why your shifts, your clock-in locations or your leave are recorded, that question belongs to your employer first. We will help them answer it.',
      'When you visit this website, create an account, pay for a subscription, write to support, or send us a crash report, we decide what happens to that information. For those we are the controller, and everything below applies to us directly.',
    ],
    evidence: 'src/lib/legalFacts.ts (PRIVACY_FACTS), docs/DATA_LIFECYCLE.md',
  },
  {
    id: 'what-we-collect',
    heading: 'What is collected, and where it comes from',
    body: [
      'Almost none of this is collected from you by us. Nearly all of it is typed into the product by an employer, or generated by using it.',
    ],
    points: [
      'Account: your first name, last name and email address, and a password held by our authentication provider, never by us in readable form. Set at sign-up or when you accept an invitation.',
      'Organisation setup: the organisation name, sector, team size, and the name and postal address of each site.',
      'Staff record: name, job title, department, contract type, contracted weekly hours, holiday allowance, skills, payroll identifier, start date, phone number, email address, a photograph if one is added, and which sites you work at.',
      'Emergency contacts: the name, relationship and phone numbers of somebody you nominate, and a free-text medical notes field described in the product as "allergies, conditions". That is health information, and it is about you and sometimes about the person you nominated.',
      'Documents: a type, a name, dates, and a web address pointing at the file. The type is free text, so right-to-work checks, DBS certificates and visa detail can end up here.',
      'Pay: an hourly rate and an effective date.',
      'Working time: shifts, availability, timesheets, overtime claims and their reasons, shift swaps and any note attached, and leave requests including the type of leave and a free-text reason. Leave type includes sickness.',
      'Attendance: each clock-in and clock-out, the time, the method, and — when you clock in by GPS — your latitude, longitude and the accuracy of that fix.',
      'Support: the messages you send us, and the email address they came from.',
      'Security records: an audit log entry for significant actions, holding the actor’s name and email address, the IP address and the browser user agent; and a record of your own active sessions.',
      'Billing: for whoever pays, the email address and card details entered on Stripe’s own checkout page, which we never see, plus the resulting subscription and invoices.',
      'Notifications: which messages were sent to you and whether they arrived, and if you turn on push notifications, the address your browser gives us for that device.',
    ],
    evidence:
      'docs/SCHEMA.md, supabase/migrations/0002_rotaflow.sql, src/components/staff/*, src/pages/app/ClockInPage.tsx',
  },
  {
    id: 'contact-form',
    heading: 'The contact form on this website',
    body: [
      'It stores nothing. The form composes a message in your own email program and you send it yourself, so nothing reaches a server of ours until you press send in your own client, and there is no database row behind it.',
      'Once you have sent it, it is an email in a mailbox like any other.',
    ],
    evidence: 'src/pages/ContactPage.tsx',
  },
  {
    id: 'why',
    heading: 'Why it is held',
    body: [
      'Each purpose below is a description of what the software does. The legal basis beside it is a proposal, not a settled position, and is one of the things a solicitor needs to confirm before this notice is published.',
    ],
    points: [
      'To provide the service an employer has asked for: building rotas, recording attendance, managing leave and swaps. Proposed basis: performance of a contract with the customer, and the customer’s own basis for its staff.',
      'To sign you in and keep your account secure, including the audit log and session records. Proposed basis: legitimate interests in keeping the service secure.',
      'To take payment and issue invoices. Proposed basis: performance of a contract, and a legal obligation to keep financial records.',
      'To answer your support messages. Proposed basis: legitimate interests, or performance of a contract.',
      'To find and fix faults, if you agreed to crash reporting. Proposed basis: consent.',
      'To remember interface preferences on your device, if you agreed. Proposed basis: consent.',
    ],
    status: 'legal-review',
    outstanding:
      'Every basis above is proposed rather than confirmed. Employment data raises a particular question: the ICO’s position is that consent is rarely valid between an employer and a worker because of the imbalance of power, which is why nothing in the product asks staff to consent to being scheduled, clocked in or located. That reasoning needs checking rather than assuming.',
    evidence: 'docs/SAAS.md CAP-058',
  },
  {
    id: 'special-category',
    heading: 'Health information and other sensitive detail',
    body: [
      'Two things in the product are special category data under Article 9, and both are named here rather than buried.',
      'The first is the medical notes field on an emergency contact. The second is sickness absence: leave has a type, and one of the types is sick, which makes an absence record a health record about a named person.',
      'One deliberate protection is worth stating because it was built for exactly this reason. When a manager uses the AI assistant, staff names, job titles, skills, contracted hours and the dates of approved leave are sent to the model provider so it can draft a rota. The type of leave is deliberately not sent, so an absence cannot be read as sickness by anybody outside the organisation.',
    ],
    status: 'legal-review',
    outstanding:
      'Holding special category data needs a condition under Article 9 as well as a basis under Article 6, and none has been identified. The document type field is free text, so immigration and criminal-record adjacent information can be entered where nobody planned for it — whether that needs a controlled list rather than a text box is a product decision with a legal edge.',
    evidence:
      'supabase/migrations/0002_rotaflow.sql, supabase/functions/ai-rota-assistant/index.ts, docs/DATA_LIFECYCLE.md',
  },
  {
    id: 'other-people',
    heading: 'People who never gave us their details',
    body: [
      'If you name an emergency contact, we hold that person’s name, relationship to you and phone numbers, and possibly information about their health, without them ever having visited this site.',
      'They have the same rights as anybody else. The product has no way to tell them so, which is a gap rather than a design: today the only route is that you tell them, or that they write to the address at the top of this notice.',
    ],
    status: 'legal-review',
    outstanding:
      'UK GDPR Article 14 covers information obtained from somebody other than the data subject, and normally requires that person to be told. Whether an exemption applies here, and what an employer must do rather than what we must do, needs advice.',
    evidence: 'src/components/staff/EmergencyContactsModal.tsx',
  },
  {
    id: 'recipients',
    heading: 'Who else sees it',
    body: [
      'The full list of processors, what each receives, where it operates and how to avoid it where that is possible, is published separately and kept beside the code that proves each row.',
      'Two of them take information outside the UK and the EU, and only two. Billing identity goes to Stripe in the United States when an organisation subscribes. Staff first and last names, job titles, skills, contracted hours and the dates of approved leave go to OpenRouter in the United States, but only at the moment a manager chooses to use the AI assistant — an organisation that never opens it sends nothing, and the feature is not on the entry plan.',
      'Everything else is in the UK or the EU: the database and files are in Ireland, error reports go to a European endpoint, images are served from the United Kingdom, and the site itself is hosted in the United Kingdom behind a global content network.',
    ],
    status: 'legal-review',
    outstanding:
      'A transfer to the United States needs a mechanism — an international data transfer agreement, the UK addendum to the standard contractual clauses, or a finding of adequacy — together with a transfer risk assessment. Neither has been done. Cloudflare sits in front of every request and operates a global edge network, and whether that is itself a transfer has not been assessed.',
    evidence: 'src/lib/subprocessors.ts',
  },
  {
    id: 'retention',
    heading: 'How long it is kept',
    body: [
      'Each kind of record has a period, and a job runs every night at 02:15 UTC to enforce it. The periods are not aspirations: the job writes a row each time it runs, and that record is the evidence it did.',
    ],
    points: [
      'Rota and shift history: 7 years.',
      'Attendance, including clock-in locations: 3 years.',
      'Leave records: 6 years.',
      'Support cases, once resolved: 3 years.',
      'Notification delivery records: 1 year.',
      'The platform audit log: kept indefinitely, and cannot be edited or deleted by anyone, including us.',
      'An organisation that deletes itself: removed immediately, not after a delay.',
    ],
    status: 'legal-review',
    outstanding:
      'These periods were chosen when the schedule was built and have not been justified against a legal or business requirement. Indefinite audit retention in particular is a decision worth defending or shortening rather than leaving as a default. Pay rates are kept through anonymisation so past labour costs remain reproducible, which is a choice that should be checked against payroll record-keeping duties.',
    evidence:
      'supabase/migrations/0027_platform_configuration.sql, 0029_retention_enforcement.sql, 0092',
  },
  {
    id: 'security',
    heading: 'How it is protected, and one thing that is not',
    body: [
      'Every organisation’s data is separated in the database itself rather than by application code, so a query cannot reach another tenant’s rows even if the interface is wrong. The site is served over TLS only, loads no third-party script, and the server refuses requests that do not arrive through the content network. The audit log is append-only, enforced by the database.',
      'One thing should be said plainly rather than omitted: there are no backups and no point-in-time recovery on the production database. That is a cost decision, not an oversight, and it has a consequence for you as well as for us — anything deleted, including anything deleted because you asked, is gone immediately and completely, and cannot be restored by anybody.',
    ],
    evidence: 'docs/SCHEMA.md §5, docs/DATA_LIFECYCLE.md, .htaccess',
  },
  {
    id: 'rights',
    heading: 'Your rights, and how to use them',
    body: [
      'You can ask for a copy of what is held about you, ask for it to be corrected, ask for it to be deleted, ask us to restrict or stop a particular use, ask for it in a portable form, and withdraw any consent you gave. Where an employer is the controller, the request goes to them and we support it.',
      'There is no self-service button for an individual, and rather than imply otherwise: write to support@rotaflow.space. Every request is logged in a register with a due date one month from receipt, extendable by two further months where a request is complex, and cannot be closed without recording what was done.',
      'A manager or owner can export a single person’s employment record as a file covering thirteen sets of data, and can export or delete the whole organisation.',
      'Deleting a person does not delete their rota. It replaces their name, email address, phone number, photograph and payroll identifier, removes their emergency contacts and documents, revokes any calendar link they had, and leaves the shifts and clock events attached to an anonymous record so the business still has a history of who was covered when. One limitation is worth knowing: the database row pointing at an uploaded file is removed, but the file itself is not deleted from the image host.',
    ],
    status: 'owner-input',
    outstanding:
      'The one-month response time is what the register computes; whether it is the right commitment to publish for both UK and EEA users needs confirming. Uploaded files surviving an erasure is a real gap with no fix wired — it needs an owner decision about the image host before this paragraph can be softened.',
    evidence:
      'supabase/migrations/0020_gdpr_requests.sql, 0111_erasure_misses_email.sql, src/services/gdprService.ts',
  },
  {
    id: 'automated-decisions',
    heading: 'Automated decisions',
    body: [
      'Nothing here decides anything about you on its own. The AI assistant drafts a rota and suggests wording for an announcement; a manager reads it, changes it and publishes it. No shift, no leave decision and no pay outcome is produced without a person choosing it.',
      'If that ever changes, this section changes with it, because a decision made purely by a machine that significantly affects somebody carries rights this notice does not currently need to describe.',
    ],
    evidence: 'supabase/functions/ai-rota-assistant/index.ts',
  },
  {
    id: 'location',
    heading: 'Location',
    body: [
      'Clocking in by GPS asks your browser for your position and records the coordinates and how accurate the reading was, alongside the time. It is requested at high accuracy, because the point is to tell one site from another.',
      'Your browser asks before it gives us anything, and declining does not stop you clocking in — the manual option remains and is recorded as manual. The result is kept for three years like the rest of the attendance record.',
    ],
    evidence: 'src/hooks/useGeolocation.ts, src/pages/app/ClockInPage.tsx',
  },
  {
    id: 'children',
    heading: 'Age',
    body: [
      'RotaFlow is sold to employers, not to individuals, and accounts are created by an employer or by invitation. There is no date of birth field anywhere in the product and no age check at sign-up.',
      'That matters more than it might sound, because the sectors this is built for — hospitality, retail, care — employ people at sixteen and seventeen.',
    ],
    status: 'owner-input',
    outstanding:
      'Whether the product should set a minimum age, and what an employer scheduling a young worker needs to be told, is unanswered. UK working-time rules for young workers differ from those for adults, and the product does not currently know which is which.',
    evidence: 'supabase/migrations/ (no date_of_birth column exists)',
  },
  {
    id: 'complaints',
    heading: 'If you are unhappy',
    body: [
      'Tell us first and we will answer. If that does not resolve it, you can complain to the Information Commissioner’s Office, the UK regulator, at ico.org.uk. If you are in the European Economic Area you may instead complain to the supervisory authority where you live.',
      'Complaining to a regulator costs nothing and does not require you to have asked us first, though we would rather you did.',
    ],
  },
  {
    id: 'changes',
    heading: 'Changes to this notice',
    body: [
      `This draft was written on ${PRIVACY_NOTICE_DRAFTED} from the state of the code on that date. When it changes materially, the date changes with it and the reason is recorded in the repository rather than only here.`,
      'The storage question you were asked when you first arrived carries its own version. If the categories change, you are asked again rather than assumed to have agreed to the new list.',
    ],
    evidence: 'src/lib/consent.ts (CONSENT_VERSION)',
  },
];

/** The sections a reader should treat as unfinished, for the page banner. */
export const PRIVACY_NOTICE_OUTSTANDING: readonly NoticeSection[] =
  PRIVACY_NOTICE_SECTIONS.filter((section) => section.status !== undefined);
