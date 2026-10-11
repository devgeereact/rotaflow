# 06. Website, content and the link from console to site

The website has to make one thing obvious within five seconds: **RotaFlow helps UK shift-based teams plan rotas, handle requests and record attendance, on any phone.** Today the copy is honest, but the structure looks templated and some claims run ahead of the product.

## 1. What exists (VERIFIED, website audit)

- Routes: `/`, `/features`, `/solutions`, `/pricing`, `/resources`, `/about`, `/contact`, five legal pages, and a 404 (`App.tsx:417-435`, `:998`).
- Copy lives mainly in `src/lib/marketing.ts` (496 lines), which claims to hold "every word" (`:21`). In fact large blocks are hard-coded in Features, Solutions, Pricing, About, Resources, Contact and several components.
- No invented logos, stats or testimonials (`TRACTION = []`, `TESTIMONIALS = []`). No gradient text, no emoji. This honesty is an asset. Keep it.
- No real screenshots. The hero is a hand-coded mock-up with fake data ("Sunnyvale Care Home").
- The contact form opens the visitor's email program (`ContactPage.tsx:117`). "Book a demo" goes to the same form. Nothing is captured.
- Per-page titles and descriptions are set in the browser after load (`usePageMetadata`). The HTML a crawler or link preview sees has only site-wide defaults, and the body is empty without JavaScript. There is a generated sitemap and a good `robots.txt`. No structured data. Unknown URLs return 200 (soft 404). One share image for every page.
- No social links (`PublicFooter.tsx:3-5`). No blog. No content tables.

## 2. Why it looks generated, and what changes

| Pattern (evidence)                                                                                        | Change                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every page opens with the same centred eyebrow, headline and paragraph                                    | Left-aligned hero with a real product screenshot beside it on desktop, below it on phones. Vary layout by what each section says                                                                                                   |
| The same 44px icon tile inside a card, 11 times. About 10 card grids. 8 identical centred section headers | Use cards only where items are truly parallel. Elsewhere, use annotated screenshots, short numbered steps, or a two-column problem and answer                                                                                      |
| A "stats band" of non-numbers: "6", "Offline", "Multi-site", "UK" (`marketing.ts:278-299`)                | Remove it. Bring back real numbers only when there are some                                                                                                                                                                        |
| Triple-clause slogan hero: "Every shift covered. Every team aligned. Even offline."                       | One plain promise, below                                                                                                                                                                                                           |
| Generic closer "Ready to simplify your scheduling?" (`FinalCta.tsx:20`)                                   | "See your own rota in RotaFlow."                                                                                                                                                                                                   |
| One typeface at stock bold sizes                                                                          | The Tesla-inspired visual language (decision D10, [04](04-DESIGN-AND-EXPERIENCE.md) §2a): Inter 400 and 500 at large sizes, flat surfaces, full-height sections, at most two calls to action per screen, frosted sticky navigation |
| No people                                                                                                 | An About page with the founder's name, photo and why they built it. B2B buyers want to know who is behind a product that will hold staff data                                                                                      |

## 3. Positioning

**Headline:** Rotas your team can actually follow.

**Subhead:** Plan and publish shifts across your sites, handle leave and swap requests in one place, and see who has clocked in, from any phone. Built in the UK for care, hospitality, retail and security teams.

**Primary call to action:** Start a 30-day trial (once decision D2 is made; until then "Join the beta"). **Secondary:** Book a 20-minute demo.

**Trust line under the buttons:** No card needed · Your data stays in the UK and EU (only if verified against the Supabase region, otherwise omit) · Cancel any time.

Keep the tagline "Scheduling certainty for every shift" (`brand.ts:12`) for the footer and social profiles unless the owner changes it.

Claims to remove or rewrite (all VERIFIED in source):

| Current                                                                                                          | Problem                                     | Replacement                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| "Every shift covered" (`marketing.ts:86`)                                                                        | Promises a staffing outcome (`BRAND.md:32`) | "See gaps before you publish"                                                   |
| "Even offline" / "keep working when the signal drops" (also in the live meta description)                        | Only three actions queue                    | "Clock-ins, leave and swap requests wait on the phone until the signal returns" |
| "Nothing is lost in a basement or a stairwell" (`TestimonialBand.tsx:8`)                                         | Guarantee                                   | "A clock-in recorded in a basement sends when the phone finds a signal"         |
| "Save time every week… takes minutes" (`marketing.ts:308-309`) and "about ten minutes" (`SolutionsPage.tsx:128`) | Unmeasured (`BRAND.md:32,38-39`)            | Remove until measured in the pilot                                              |
| "Maintain compliance" (`marketing.ts:320`), "Built for UK obligations" (`TestimonialBand.tsx:17`)                | Near-compliance promise                     | "Rest-break and 48-hour warnings on the rota, and a record of every clock-in"   |
| "Most popular" (`PricingPage.tsx:88`)                                                                            | No customers                                | Remove                                                                          |
| About: "the pricing page says billing is not live" (`AboutPage.tsx:33`)                                          | Contradicts pricing                         | Remove the sentence                                                             |
| Resources: "Built and in use today" (`ResourcesPage.tsx:98`)                                                     | No customers yet                            | "Available today"                                                               |

## 4. Page-by-page plan

| Page             | Structure                                                                                                                                                                                                             | Notes                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Home             | Hero with screenshot → three jobs RotaFlow does (Plan the week, Handle requests, Know who's in), each with a real screenshot → the staff phone view → sectors strip → pricing summary → founder note → call to action | Under 7 sections. No stats band                                                                                 |
| Features         | Five groups: Plan, Requests, Attendance, Hours and reports, Your team. Each item links to a help article                                                                                                              | Every item maps to a built capability in SAAS.md. AI assistant listed as "on Business and Enterprise"           |
| Solutions        | One page per sector only when a pilot customer exists in it. Until then, one page with care and hospitality worked examples                                                                                           | Care: CQC evidence, planned versus actual hours, document expiry. Hospitality: labour cost, rest-break warnings |
| Pricing          | Four plans, monthly and annual toggle, "prices exclude VAT" line, trial terms, a short comparison table, 6 FAQs                                                                                                       | Matches `0023` through the existing test                                                                        |
| Resources        | Getting-started guides, "What's new" changelog, help articles. All from the content source (§6)                                                                                                                       | Ends the hard-coded changelog that stopped at 13 Aug                                                            |
| About            | Founder name and photo, why RotaFlow exists, where it is built, how to reach a person                                                                                                                                 | Real photo with permission only                                                                                 |
| Contact and demo | Short form (§5), the support email, and response hours                                                                                                                                                                |                                                                                                                 |
| Legal            | Privacy, Terms, Cookies, Accessibility, Trust                                                                                                                                                                         | Draft banners removed only after the review in [05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S8                   |
| 404              | Real 404 status                                                                                                                                                                                                       | `.htaccess` returns 404 for unknown paths that are not app routes                                               |

**Imagery.** Three real screenshots with synthetic data, each annotated: the manager rota with one coverage warning, the staff phone with next shift and Clock in, and the approvals inbox. Capture them with Playwright from the DEV preview routes so they are regenerated after every visual change, not hand-edited, and show them in CSS device frames (12px media radius). The hero moves only on entrance, through CSS keyframes and one small `IntersectionObserver` hook, never loops, and is static under reduced motion. No new dependency. The earlier idea of a silent screen recording in the hero is dropped in favour of this; a short captioned clip can still live further down a page, with a still frame for reduced motion.

**Visual language (decision D10).** The whole public site follows [04](04-DESIGN-AND-EXPERIENCE.md) §2a: flat, no resting shadows, 4px control radius, Inter 400 and 500, 0.33s colour transitions, full-height sections, at most two calls to action per screen (on the home hero: "Start a 30-day trial" and "Book a 20-minute demo"), and a frosted sticky navigation bar. Brand blue stays `#3B6FE0`. The reference brand is never named and its logo never appears, in copy, metadata, alt text or file names.

**SEO and link previews.** Prerender the public routes at build time (a small Vite step that writes each public route's HTML with its own title, description, canonical and share image). This also fixes link previews on LinkedIn and WhatsApp. Add `Organization` and `SoftwareApplication` JSON-LD with real facts only. One share image per main page. Real 404s.

## 5. Forms: capture every enquiry

Replace the mailto form with a real intake:

- A new Edge Function `public-enquiry`, with Turnstile verification, field validation, and a rate limit per IP.
- It writes to a new `enquiries` table (RLS on, no `anon` grant, service-role insert only) and queues a notification to the platform owner through the existing outbox.
- Fields: name, work email, organisation, team size (bands), sector, message, "I'd like a demo" checkbox, and an unticked marketing consent box.
- The page shows "Thanks, we've got your message. We reply within one working day" only after the server accepts it. On failure, it shows the support email.
- The console gets an **Enquiries** inbox ([03](03-PLATFORM-AND-BILLING.md) A2): status New, Replied, Demo booked, Closed. No CRM.
- "Book a demo" can link to a hosted calendar booking page once the owner has one. No booking system is built.

## 6. The content source: linking the console to the website and app

The owner asked that things like blog posts, social links and forms change in one place and appear everywhere. The smallest model that does that:

### 6.1 What lives where

| Content                                                            | Single home                                                        | Shown on                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Brand name, tagline, descriptions                                  | `src/lib/brand.ts` (code, reviewed)                                | Website, app, profiles                                                               |
| Prices and plan limits                                             | `plans` table (`0023`), already tested against the pricing page    | Pricing, onboarding, billing page                                                    |
| Social profile links, support email, response hours, status notice | `site_settings` (new, console-edited)                              | Website footer and contact page, app Help page                                       |
| Blog posts and guides                                              | `content_items` (new, console-edited)                              | Website Resources and article pages, app Help                                        |
| "What's new" entries                                               | `content_items` with type `changelog`                              | Website Resources, an app "What's new" panel                                         |
| Help articles                                                      | `content_items` with type `help`, audience owner, manager or staff | App Help (by audience), website Resources                                            |
| In-app service notices                                             | `platform_announcements` (exists, `0025`)                          | App only                                                                             |
| Enquiries                                                          | `enquiries` (new)                                                  | Console only                                                                         |
| Legal text                                                         | Code (`legalFacts.ts`, `privacyNotice.ts`, `termsDraft.ts`)        | Legal pages. Legal text stays in code, so every change is reviewed in a pull request |

### 6.2 Proposed tables (design only)

`content_items`: id, type (`post`, `guide`, `help`, `changelog`), slug, title, summary, body (Markdown), audience (`public`, `owner`, `manager`, `staff`), cover image and alt text, author, status (`draft`, `in_review`, `published`, `unpublished`), published_at, reviewed_at, seo_title, seo_description, created and updated timestamps, plus a version table for rollback.

`site_settings`: one row: support email, response hours, social links (Instagram, Facebook, LinkedIn, TikTok, WhatsApp Community invite), and an optional site notice (text, link, ends_at).

Both are platform-wide, not tenant data, so they carry no `org_id`. Writes are platform owner and admin only, through RPCs with audit. This must be recorded as a deliberate exception to "every domain table carries `org_id`" in DATA-MODEL.md (was SCHEMA.md) and in the RLS invariant test.

### 6.3 How the website reads it

`anon` has no table grants, and that stays true. Two read paths:

1. **Build time.** The prerender step (§4) fetches published content through a read-only Edge Function `public-content` and writes static pages for every published article. Search engines and link previews see full pages.
2. **Run time.** The same function, cached for 5 minutes, lets the website pick up a new post, changed social link or site notice without a redeploy. A post published after the last build still renders in the browser and appears in the sitemap at the next build.

If the function is down, the site falls back to the build-time snapshot, so the website never breaks because of the editor.

### 6.4 The editor in the console

One Content section with two tabs: **Articles** (list, filter by type and status, edit with Markdown and preview, Save draft, Submit for review, Publish, Unpublish, version history) and **Site settings** (the single form). No page builder, no workflow engine, no tenant blogs, no automatic AI writing. Phase 3, once there is someone to write regularly (decision D9). Until then, the four starter guides live as Markdown files in the repository and are imported into the table when the editor ships.

### 6.5 Social posts

Each published post gets a "Copy for LinkedIn" button that copies the title, summary and link. Posting stays manual. No automatic cross-posting.

## 7. First four articles

1. How to publish a rota your team can follow.
2. What staff should do when a clock-in has not sent yet.
3. Checking recorded hours before you export timesheets.
4. Handling leave and swap requests without losing the decision.

Each one has a named reviewer, a real "last reviewed" date, and screenshots with synthetic data. No legal advice articles and no filler written for search engines.

## 8. Measurement

Count: enquiries, demos booked, trials started, setup completed, first rota published, and organisations active in week 4. These come from existing tables plus `enquiries`. Do not add a third-party tracker before the privacy notice says so. No session replay.
