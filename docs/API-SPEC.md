# API specification

The PHP API in `backend/`: 242 route entries in 36 modules (204 distinct paths), counted on 2026-11-09 from the `routes()` arrays in `backend/src/Mod`
(a path used with both GET and POST counts once). The route tables in section 4 are generated from those arrays, not typed.
The contracts of the retired Supabase Edge Functions and RPCs are kept in git (section 7), not in this document.

How to recount:

```bash
grep -hoE "\['(GET|POST)',[[:space:]]*'[^']+'" backend/src/Mod/*.php | wc -l                                                     # 242 route entries
grep -hoE "\['(GET|POST)',[[:space:]]*'[^']+'" backend/src/Mod/*.php | sed -E "s/.*,[[:space:]]*'([^']+)'/\1/" | sort -u | wc -l   # 204 distinct paths
ls backend/src/Mod/*.php | wc -l                                                                                                  # 36 modules
```

## 1. Overview

- **Base path and front controller.** Every URL is `/api/...`. Apache sends it to `backend/public/api/index.php`, which strips the `/api` prefix, loads the
  application (`backend/src/Autoload.php`, from `src/` beside it in development and from the private app folder on the host) and hands the request to `RotaFlow\Api::handle` (`backend/src/Api.php`).
  Diagnostics go to a log, never to the response body (`display_errors` is off); the `X-Powered-By` header is removed.
- **Verbs.** Only GET and POST exist. Every mutation is a POST with the verb in the path (`/orgs/{o}/rotas/{r}/publish`). The front controller answers any other
  method with **405** `method_not_allowed` and `Allow: GET, POST`. A search of `backend/src/Mod` finds no route with another verb: of the 242 route entries, 91 are GET and 151 are POST.
- **Health.** `GET /api/health` answers `{"ok":true}` with 200 before configuration is read, so it shows the entry point is alive; `Api::handle` also answers `/health`.
  It is not one of the 242 route entries. A 200 from it says nothing about the database or the sign-in settings.
- **Modules and route entries.** A module is a class in `backend/src/Mod` that implements `Module` (`backend/src/Module.php`) and returns its routes from `routes()`;
  `Modules::all` (`backend/src/Modules.php`) loads every such class in file-name order. A route entry is the tuple
  `[method, template, handler, 'public'?, 'raw'?, 'upload'?]`:
  - the fourth element `'public'` means no sign-in (the handler must authorise itself);
  - the fifth element `'raw'` hands the handler the untouched body and headers (`__raw`, `__headers`), which a signed webhook needs;
  - the sixth element `'upload'` or `'upload-document'` raises the body limit (below).
  A handler receives `($principal, $input, $ip, ...placeholders)` and returns `[status, payload]`.
- **Matching.** A template is matched literally except for placeholders. A placeholder is `{x}` with one lower-case letter and matches 36 characters of lower-case hexadecimal digits and hyphens
  (`[0-9a-f-]{36}`); the router does not check that it is a real UUID (`Scope::membership` does for the organisation). `{o}` is the organisation in every org-scoped route; the other letters
  (`{s}`, `{r}`, `{d}` ...) name a row of that route's own module and are not shared between modules. The verb is part of the match: a known path with the wrong verb is, to the router, no route.
- **No match.** A signed-in caller gets **404** `not_found`; a caller who is not signed in gets **401** first, so routes cannot be probed.
- **JSON in and out.** Responses are `application/json; charset=utf-8` with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
  A request body must decode to a JSON object or the answer is **422** `invalid_input` ("Body must be a JSON object"). For a GET, a non-empty query string replaces the body as the input (values are strings).
  Fields are read strictly by `backend/src/Input.php`: a value of the wrong type is "absent", never cast; dates are `YYYY-MM-DD` and must exist; times in and out are ISO 8601 with an offset (UTC in the database).
- **Body limits** (`backend/src/Api.php`): 256 KB of JSON by default (262144 bytes); 3 MiB for the one route that carries a picture as base64 (`POST /orgs/{o}/staff/{s}/photo`, element `'upload'`);
  14 MiB for the one route that carries a staff document as base64 (`POST /orgs/{o}/documents`, element `'upload-document'`); 1 MiB for the two raw public routes. Over the limit: **413** `too_large`.
  Files travel inside the JSON body as base64 (`data` in `backend/src/Mod/Photos.php` and `backend/src/Mod/Compliance.php`); there is no multipart upload. A photo must be JPEG, PNG or WebP of at most 2 MiB, a document PDF, JPEG, PNG, WebP or HEIC of at most 10 MiB, judged from the bytes; otherwise **415** `photo_type` / `document_type` or **413** `photo_too_large` / `document_too_large`.
- **Non-JSON responses.** A module may return `__raw` (the calendar feed, a stored file, the payroll CSV): `Api::rawHeaders` builds `Content-Type`, `Cache-Control` (default `no-store`), `Content-Disposition` (`inline`, or `attachment` if the module asks; the file name keeps only ASCII letters, digits, `_`, space, `.`, `(`, `)` and `-`) and any `X-RotaFlow-...` header whose value is plain ASCII.
- **Client address.** `REMOTE_ADDR`, or `CF-Connecting-IP` when the private setting `trust_cf_connecting_ip` is on and the connection comes from a Cloudflare address range (`Bootstrap::fromCloudflare`). The live value of that setting is `NOT VERIFIED` (server configuration).
- **Success statuses.** 200 for almost every success, 201 for a create (40 `return [201` sites in `backend/src/Mod`).

## 2. Authentication and tenancy

### Sign-in

- **Token.** `Authorization: Bearer <Clerk session token>`; anything not matching `^Bearer ([A-Za-z0-9._-]+)$` is **401** `unauthorized` ("Sign in required").
- **Verification** (`backend/src/Jwt.php`): at most 8192 characters, three parts, header `alg` must be `RS256` and carry a `kid`; the signature is checked against the issuer's published key set
  (cached under the private root, fetched again when the `kid` is unknown; keys under 2048 bits and keys labelled for another algorithm are ignored); then `iss` must equal the configured issuer, `exp` must not be past (5 seconds of leeway), `nbf` must not be ahead,
  `sub` must be present, the session status `sts` must be `active`, and `azp` must be one of the configured authorised parties. There is no audience check; the authorised party is the equivalent. Any failure is a bare 401.
  Setting names read in `backend/src/Bootstrap.php`: `clerk_issuer`, `clerk_authorized_parties`.
- **From token to person** (`backend/src/Users.php`): the identity is the Clerk user id (`users.clerk_user_id`). The token must carry a usable `email` (a valid address of at most 255 characters); if it carries `email_verified`, anything but true is refused (401).
  A first sign-in links an existing `users` row by that email (a person created before they signed in, or an invitation) or creates one; an email already bound to a different Clerk identity answers **409** `email_in_use`; `last_seen_at` is written at most every 300 seconds.
  The handler's `$principal` is `{id, email, clerk_id, sub}` where `id` is the local user id.
- **Rate limit after sign-in.** 600 requests per minute per Clerk subject (bucket `api-user`), then **429** `rate_limited`.

### Tenancy

- **Org-scoped routes** are `/orgs/{o}/...`. Every handler starts with `Scope::membership` (`backend/src/Scope.php`): the organisation id is validated as a UUID and never trusted; the role is read from the database
  (an active membership of an organisation that is not archived). A malformed id, an unknown organisation and a non-member all get **404** `not_found`, so ids cannot be probed.
- **Wrong role.** `Scope::require` compares the effective role and answers **403** `forbidden`; `Scope::requireReal` compares the real role (a delegate cannot do these acts). Owner and manager are `Scope::MANAGERS`.
- **Not allowed to write.** A suspended organisation answers **403** `org_not_active`; a read-only support session answers **403** `support_read_only` (`Scope::requireWritable`). An unpaid or over-limit organisation can answer **402** (`billing_read_only` and the limit codes in `backend/src/Billing.php`).
- **Feature flags.** A module that ships dark answers **403** `feature_off` while its flag is off for the organisation (`staff_documents`, `scheduling_tools`, `cover_tools`, `timesheet_tools`, `two_way_swaps`, `ai_rota_assistant`; see `backend/src/Flags.php`), In each module that has one (Cover, Compliance, Scheduling, Timesheets, Swaps' two-way options, AiAssistant) the flag is checked after the membership check, so a stranger still gets 404.
- **Support sessions and delegation.** A platform administrator with a live support session enters as a `support` member with a manager's reach; a staff member with a live delegation has the effective role manager. Both are resolved inside `Scope::membership` (see `docs/DATA-MODEL.md` section 2).
- **Platform routes** (`/platform/...`, and the console) are not org-scoped. The guard is a platform role read with `Scope::platformRole`; the per-module rule (which roles, and whether a caller without the role gets 404 or 403) is in the module's entry in section 4.
  In `backend/src/Mod/Lifecycle.php` a caller without the required platform role gets 404.

### Public routes (no sign-in)

Six route entries carry `'public'`. Each limits itself to 300 requests per minute per address (bucket `api-public`) and authorises itself:

| Module | Route | Authorised by |
| --- | --- | --- |
| `CalendarFeed` | `GET /ics` | a secret token in the query (43 URL-safe characters, only its SHA-256 stored); the person must still be active; misses are rate limited per address |
| `Compliance` | `GET /document-files` | a signed link issued by `GET /orgs/{o}/documents/{d}/link` (path, expiry, HMAC signature) |
| `Enquiries` | `POST /enquiries` | origin, content type, size, honeypot, optional Turnstile and rate limits (section 5) |
| `Invites` | `POST /invites/preview` | the invitation token in the body; 30 a minute per address |
| `Photos` | `GET /files` | a signed link issued by `GET /orgs/{o}/staff/{s}/photo-link` (bucket, path, expiry, HMAC signature) |
| `StripeWebhook` | `POST /stripe/webhook` | the Stripe signature (section 5) |

### Signed links

- **Stored files** are never at a guessable address. `GET /orgs/{o}/staff/{s}/photo-link` (`backend/src/Mod/Photos.php`) and `GET /orgs/{o}/documents/{d}/link` (`backend/src/Mod/Compliance.php`) issue a URL on the public `/files` or `/document-files` route with query `p` (path), `e` (expiry), `s` (HMAC-SHA256 signature from `Photos::sign`, key derived from the private HMAC secret) and, for photos, `b` (bucket).
  A photo link lasts 3600 seconds, a document link 60 seconds; a bad or expired photo link is a bare 404 and stops working once the picture is replaced or removed (`Photos::serve`).
- **Calendar feed.** `POST /orgs/{o}/calendar-feed/issue` (`backend/src/Mod/CalendarFeed.php`) returns a secret token once (only its SHA-256 is stored); the public `GET /ics?token=...` serves that person's published shifts. A new token revokes the old one, an unused feed switches off after 90 days, and a bad token is a bare 404.

### Rate limits

Besides the two global buckets, these named buckets are hit by the module that owns the action (a hit over the limit is **429** `rate_limited`). Counters live in the `rate_limits` table (`backend/src/RateLimiter.php`, a fixed window per bucket and subject).

| Bucket | Limit | Per | Module |
| --- | --- | --- | --- |
| `api-public` | 300 a minute | address | every public route (`backend/src/Api.php`) |
| `api-user` | 600 a minute | Clerk subject | every signed-in route (`backend/src/Api.php`) |
| `client-audit` | 120 an hour | person | `Account` |
| `announcement-remind` | 6 an hour | announcement | `Announcements` |
| `billing-checkout` | 20 an hour | organisation | `Billing` |
| `billing-portal` | 30 an hour | organisation | `Billing` |
| `billing-contact` | 20 an hour | organisation | `Billing` |
| `billing-links` | 60 an hour | organisation | `Billing` |
| `calendar-issue` | 10 an hour | person | `CalendarFeed` |
| `calendar-feed` | 120 an hour | staff record | `CalendarFeed` |
| `calendar-miss-guard` | 600 an hour | address | `CalendarFeed` |
| `calendar-miss` | 30 an hour | address | `CalendarFeed` (a token that matches nothing) |
| `compliance-type` | 60 an hour | person | `Compliance` |
| `compliance-doc` | 60 an hour | person | `Compliance` |
| `compliance-doc-org` | 500 a day | organisation | `Compliance` |
| `platform-admins` | 30 an hour | person | `Console` |
| `support-session` | 30 an hour | person | `Console` |
| `enquiry-ip` | 5 an hour | address (keyed hash) | `Enquiries` |
| `enquiry-all` | 100 an hour | all callers | `Enquiries` |
| `gdpr-self` | 10 an hour | person | `Gdpr` |
| `incident-declare` | 30 an hour | person | `Incidents` |
| `invite-org` | 60 an hour | organisation | `Invites` |
| `invite-resend` | 30 an hour | organisation | `Invites` |
| `invite-preview` | 30 a minute | address | `Invites` |
| `invite-accept` | 10 an hour | person | `Invites` |
| `org-delete` | 10 an hour | person | `Lifecycle` |
| `push-subscribe` | 30 an hour | person | `Notifications` |
| `smtp-test` | 10 an hour | organisation | `OrgSettings` |
| `org-create` | 5 an hour | person | `Orgs` |
| `slug-check` | 60 a minute | person | `Orgs` |
| `photo-upload` | 20 an hour | person | `Photos` |
| `platform-org-create` | 20 an hour | person | `Platform` |
| `announce-publish` | 20 an hour | person | `PlatformAnnouncements` |
| `support-open` | 10 an hour | person | `Support` |
| `support-reply` | 60 an hour | person | `Support` |
| `ai-assistant` | 30 an hour | person | `AiAssistant` |
| `ai-assistant-org` | 200 an hour | organisation | `AiAssistant` |

## 3. Errors and conventions

- **One error shape.** `{"error":{"code":"...","message":"..."}}` with a stable `code` (`HttpError::body` in `backend/src/HttpError.php`). An unexpected exception is **500** `internal`, "Something went wrong", with a `correlation_id` (12 hex characters) that matches a line in the private log; no trace or internals are returned (`backend/public/api/index.php`).
- **Factories.** `HttpError::notFound` (404 `not_found`), `forbidden` (403 `forbidden`), `unauthorized` (401), `invalid` (422 `invalid_input`), `conflict(code, message)` (409, caller-chosen code).
- **Statuses in use** (distinct values of `new HttpError(` in `backend/src`): 400, 402, 403, 404, 413, 415, 422, 429, 500, 502, 503, 507, plus 401, 405 and 409 through the factories and the front controller.
  Typical meanings: 409 for a business-rule conflict (`rota_published`, `leave_overlap`, `cover_below_minimum`, `already_exported` ...), 422 for a field that fails validation, 502 and 503 when a provider (AI, Stripe) or a feature is unavailable (`ai_unavailable`, `billing_provider`, `billing_unavailable`, `not_configured`), 507 `storage_full` when the file store has no room (`backend/src/FileStore.php`).
- **Exceptions to the shape.** The public enquiry route (`backend/src/Mod/Enquiries.php`) answers `{"error":"code"}` with a string for its own failures (`origin_not_allowed`, `unsupported_media_type`, `too_large`, `invalid` with a `fields` list, `verification_failed`, `rate_limited`), and `{"ok":true}` with 201 on success. The Stripe webhook uses the standard shape for its errors and `{"received":true}` on success.
- **Idempotency of offline writes.** A device mints a `client_event_id` before the first attempt of a clock event, leave request or shift swap; a replay finds its earlier row and answers 200 with `already_applied: true` instead of creating a second one (read in `backend/src/Mod/Clock.php`; the `backend/migrations/006-time-and-requests.sql` header states the same for the others, and each of the three tables has a unique key on `client_event_id`). The browser queue that replays them is described in `docs/ARCHITECTURE.md`.
- **Pagination.** There is no general convention; each list that takes one names its own parameters. `limit` alone: `GET /orgs/{o}/notifications` (1 to 100, default 50), `GET /orgs/{o}/clock-events` (1 to 1000, default 200; `latest=1` returns one), `GET /platform/support/cases` (1 to 200, default 100), `GET /platform/notifications/activity` (1 to 1000, default 1000). `limit` and `offset` (echoed back): the console organisation and user lists (`backend/src/Mod/Console.php`, 1 to 100, default 50), `GET /platform/audit` (`backend/src/Mod/PlatformAudit.php`, 1 to 200, default 50, with a `total`) and the platform invoice list (`backend/src/Mod/PlatformBilling.php`, 1 to 200, default 25). A keyset cursor: `GET /orgs/{o}/audit` (`backend/src/Mod/Account.php`) takes `limit` (1 to 100, default 50) and `before_id`. Every other list returns a fixed, capped set (for example the rota list is limited to 500 rows in `backend/src/Mod/Rotas.php`).
- **Times.** Instants are ISO 8601 with an offset; dates are `YYYY-MM-DD`; the database stores UTC.

## 4. Route reference

One subsection per module, in alphabetical order of file name. Each table is generated from the module's `routes()` array: the verb, the path under `/api`, the handler method in that module, and the tuple flag (`public`, `raw`, `upload`, `upload-document`) where there is one.
The lines under a table say what the module does, who may call it and which tables it writes. "Tables written" lists the tables whose rows the module's own SQL inserts, updates or deletes; most state-changing handlers also append an audit row through `Audit::log` (`backend/src/Audit.php`) and queue notifications through `Notify` (`backend/src/Notify.php`), and those are named only where they are the module's job.

### Account (`backend/src/Mod/Account.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/me/settings` | `getSettings` |  |
| POST | `/me/settings` | `saveSettings` |  |
| POST | `/me/profile` | `saveProfile` |  |
| POST | `/orgs/{o}/onboarding/complete` | `completeOnboarding` |  |
| GET | `/orgs/{o}/audit` | `audit` |  |
| POST | `/orgs/{o}/audit` | `record` |  |

What it does: A person's own settings and profile, finishing an organisation's setup, and the organisation's audit trail.

Access: `/me/settings` and `/me/profile` need only sign-in and act on the caller's own row (no organisation id). `POST /orgs/{o}/onboarding/complete` is `Scope::membership` then owner. `GET /orgs/{o}/audit` is any member: an owner reads every entry visible to the organisation, anyone else only the entries they caused; the list takes `limit` (1 to 100, default 50) and `before_id`. `POST /orgs/{o}/audit` is any member and records one of a fixed list of client actions (`CLIENT_ACTIONS`), 120 an hour per person.

Tables written: `users`, `organisations`, `app_settings`, and `audit_logs` (the `record` route).

### AiAssistant (`backend/src/Mod/AiAssistant.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/orgs/{o}/ai/rota` | `run('rota')` |  |
| POST | `/orgs/{o}/ai/announcement` | `run('announcement')` |  |

What it does: The AI rota assistant. Two tasks share one grounding query: turn a staffing request into shift suggestions, and draft an announcement about what is actually on the rota this period. Every suggestion is checked before it is returned (section 6).

Access: The caller must be an owner or manager of the organisation (effective role, so lent authority counts), never a support session; the plan must include `ai_rota_assistant` (403 `plan_required`); the flag must be on (403 `feature_off`); the server must hold an OpenRouter key (503 `ai_unavailable`); and the limits are 30 an hour per person and 200 an hour per organisation (429). Each refusal is made before any outside call.

Tables written: `audit_logs` only: one row per completed request, with counts and lengths and no text.

### Announcements (`backend/src/Mod/Announcements.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/announcements` | `list` |  |
| POST | `/orgs/{o}/announcements` | `save` |  |
| POST | `/orgs/{o}/announcements/{n}` | `save` |  |
| POST | `/orgs/{o}/announcements/{n}/publish` | `publish` |  |
| POST | `/orgs/{o}/announcements/{n}/delete` | `delete` |  |
| POST | `/orgs/{o}/announcements/{n}/read` | `read` |  |
| GET | `/orgs/{o}/announcements/{n}/reads` | `reads` |  |
| POST | `/orgs/{o}/announcements/{n}/remind` | `remind` |  |

What it does: Organisation notices. Publishing for the first time queues one notification to the audience (everyone, one department, or one location through its departments); editing a published notice notifies nobody a second time.

Access: `GET /orgs/{o}/announcements` is any member: a manager also sees drafts and the read counts, everyone else only published notices (at most 200). `read` is any member with a staff record (403 `no_staff_record` otherwise). Save, publish, delete, `reads` and `remind` are owner or manager (writes also need a writable organisation); `remind` is limited to 6 an hour per announcement and needs the notice to be published.

Tables written: `announcements`, `announcement_reads`; publishing and reminders queue rows in `notification_outbox` through `Notify`.

### Billing (`backend/src/Mod/Billing.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/plans` | `plans` |  |
| GET | `/orgs/{o}/billing/state` | `stateRoute` |  |
| GET | `/orgs/{o}/billing` | `account` |  |
| POST | `/orgs/{o}/billing/checkout` | `checkout` |  |
| POST | `/orgs/{o}/billing/portal` | `portal` |  |
| POST | `/orgs/{o}/billing/sync-contact` | `syncContact` |  |
| POST | `/orgs/{o}/billing/invoices/{i}/links` | `invoiceLinks` |  |

What it does: What an organisation sees and does about billing. Any member may read the state (the app shows a banner and greys out writes); only the real owner sees the account or acts on it. Stripe is reached only here and in the webhook, in the mode set by the private configuration; checkout and the portal return to the configured app URL, not the `Origin` header.

Access: `GET /plans` needs only sign-in (the price list, with whether a price id exists for the current mode). `GET /orgs/{o}/billing/state` is any member. `GET /orgs/{o}/billing`, `checkout`, `portal`, `sync-contact` and `invoices/{i}/links` are the owner (effective role). `POST /orgs/{o}/billing/checkout` takes one field, `plan` (`starter`, `professional` or `business`; enterprise is by arrangement); it is limited to 20 an hour per organisation, and 503 `billing_unavailable` or 502 `billing_provider` answer when Stripe is not set up or fails.

Tables written: none by its own SQL (found by a search of the module); Stripe references and subscription state are written by `backend/src/Billing.php` and, on payment events, by `StripeWebhook`.

### CalendarFeed (`backend/src/Mod/CalendarFeed.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/calendar-feed` | `status` |  |
| POST | `/orgs/{o}/calendar-feed/issue` | `issue` |  |
| POST | `/orgs/{o}/calendar-feed/revoke` | `revoke` |  |
| GET | `/ics` | `feed` | public |

What it does: A private iCalendar feed of a person's published shifts, to subscribe to from a phone calendar. The URL carries a secret token (only its SHA-256 is stored); a person can issue a new one (which revokes the old) or revoke it, and an unused feed switches off after 90 days.

Access: `GET /orgs/{o}/calendar-feed` is any member (own status). `issue` and `revoke` need a staff record and a writable organisation (403 `no_staff_record` otherwise); `issue` is limited to 10 an hour per person. `GET /ics` is public, authorised by the token in the query; the feed also stops when the person is suspended or removed, and a bad token is a bare 404 (limits in section 2).

Tables written: `calendar_feed_tokens`.

### Clock (`backend/src/Mod/Clock.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/clock-events` | `list` |  |
| POST | `/orgs/{o}/clock-events` | `record` |  |
| POST | `/orgs/{o}/clock-events/{e}/delete` | `delete` |  |
| POST | `/orgs/{o}/clock-events/{e}/correct` | `correct` |  |
| GET | `/orgs/{o}/clock-events/{e}/corrections` | `corrections` |  |

What it does: Clock events (in, out, break start, break end) and managers' corrections of them. The server, not the device, decides the time: a person's `event_at` is trusted only within 5 minutes ahead of the server clock and at most 72 hours behind it (an offline queue can replay late); otherwise the server time is used and the device's claim is kept in `event_at_reported`. The geofence is recorded, not enforced.

Access: `GET /orgs/{o}/clock-events` is any member (a manager reads everyone's, anyone else their own). `POST /orgs/{o}/clock-events` is any member with a staff record, on a writable organisation, for themselves; an owner or manager may record any time for anyone (a person with no staff record gets 403 `no_staff_record`, recording for someone else without the role 403 `forbidden`). `delete`, `correct` and `corrections` are owner or manager (delete and correct also writable). Fields of `POST /orgs/{o}/clock-events`: `type` (`in`, `out`, `break_start`, `break_end`), `staff_profile_id` (default: the caller's own), `method` (`gps`, `qr`, `manual`; default `manual`), `shift_id`, `latitude` (-90 to 90), `longitude` (-180 to 180), `accuracy` (0 to 100000), `event_at` (an instant), `location_name` (at most 200 characters) and `client_event_id`. A new event is 201 with `already_applied: false`; a replay of the same `client_event_id` is 200 with `already_applied: true`; clocking in twice within five minutes is refused (header of `backend/src/Mod/Clock.php`).

Tables written: `clock_events`, `clock_event_corrections`, and `timesheets` (a correction inside an approved period sets `recalculation_required_at`).

### Compliance (`backend/src/Mod/Compliance.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/document-types` | `listTypes` |  |
| POST | `/orgs/{o}/document-types` | `createType` |  |
| POST | `/orgs/{o}/document-types/presets` | `addPreset` |  |
| POST | `/orgs/{o}/document-types/{t}/update` | `updateType` |  |
| POST | `/orgs/{o}/document-types/{t}/archive` | `archiveType` |  |
| GET | `/orgs/{o}/documents` | `listDocuments` |  |
| POST | `/orgs/{o}/documents` | `createDocument` | upload-document |
| GET | `/orgs/{o}/documents/queue` | `queue` |  |
| POST | `/orgs/{o}/documents/{d}/submit` | `submit` |  |
| POST | `/orgs/{o}/documents/{d}/review` | `review` |  |
| POST | `/orgs/{o}/documents/{d}/withdraw` | `withdraw` |  |
| GET | `/orgs/{o}/documents/{d}/link` | `link` |  |
| GET | `/orgs/{o}/compliance/me` | `mine` |  |
| GET | `/orgs/{o}/compliance/summary` | `summary` |  |
| GET | `/document-files` | `serve` | public |

What it does: Document types, staff documents with review, the eligibility service the cover module consumes, and expiry reminders. An upload never counts until an owner or manager approves it; replacing a document adds a row and the earlier approved row becomes `superseded` when the new one is approved.

Access: Every route refuses a platform support session (403: Super Admin has no role in compliance) and answers 403 `feature_off` while the `staff_documents` flag is off (the plain read `GET /orgs/{o}/documents` stays open while it is off, because it answered before the module existed). Reads of document types, `compliance/me` and `compliance/summary` are any member. Creating, updating or archiving a document type, `documents/queue` and `review` are owner or manager. Documents are visible only to the person and to owners and managers (delegates included). `POST /orgs/{o}/documents` adds the caller's own document (403 `You can only add your own documents` otherwise) and is the 14 MiB upload route; `submit` and `withdraw` are the person the record belongs to or an owner or manager (anyone else gets 404); withdrawing an approved document is refused (403: ask a manager to remove it). Four eyes: nobody reviews a document about themself, and a manager who uploaded a document for someone else cannot approve it (an owner can). `GET .../documents/{d}/link` issues a 60-second signed link. Limits: 60 an hour per person for types and for documents, 500 a day per organisation.

Tables written: `document_types`, `documents`, `document_reminders`.

### Console (`backend/src/Mod/Console.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/settings` | `settings` |  |
| POST | `/platform/settings` | `saveSettings` |  |
| GET | `/platform/admins` | `admins` |  |
| POST | `/platform/admins` | `grant` |  |
| POST | `/platform/admins/{u}/revoke` | `revoke` |  |
| GET | `/platform/summary` | `summary` |  |
| GET | `/platform/notifications/activity` | `notificationActivity` |  |
| GET | `/platform/orgs` | `orgDirectory` |  |
| GET | `/platform/orgs/{o}` | `orgDetail` |  |
| GET | `/platform/orgs/{o}/structure` | `orgStructure` |  |
| POST | `/platform/orgs/{o}/status` | `setStatus` |  |
| GET | `/platform/users` | `userDirectory` |  |
| GET | `/platform/users/{u}` | `userDetail` |  |
| GET | `/platform/support-sessions` | `allSessions` |  |
| POST | `/platform/orgs/{o}/support-sessions` | `requestSession` |  |
| POST | `/platform/support-sessions/{s}/revoke` | `platformRevoke` |  |
| POST | `/orgs/{o}/support-access` | `consent` |  |
| GET | `/orgs/{o}/support-sessions` | `orgSessions` |  |
| POST | `/orgs/{o}/support-sessions/{s}/revoke` | `orgRevoke` |  |

What it does: The Super Admin console's core: who the platform staff are, platform settings, the directories and totals, suspending an organisation, and support access (platform staff entering a customer's data, only with the customer's consent, for a stated reason, for a limited time). Roles: `platform_owner` (everything, and the only one who changes who is staff), `platform_admin`, `platform_support` (support access, cases), `platform_finance` (billing).

Access: A caller without the needed platform role gets 404 from `/platform/*`. `GET /platform/settings` is any signed-in person (the app reads the maintenance notice and support address from it); `POST /platform/settings` is platform owner or admin. `GET /platform/admins`, `summary`, `GET /platform/orgs` and `GET /platform/orgs/{o}` are any of the four platform roles; granting or revoking a platform role is platform owner only (30 an hour). `notifications/activity`, `orgs/{o}/structure`, the user directory and detail, `support-sessions` and `orgs/{o}/support-sessions` (request) are platform owner, admin or support; `orgs/{o}/status` (suspend or reinstate) is owner, admin or finance. `POST /orgs/{o}/support-access` (the customer's consent) is the real owner of the organisation; `GET /orgs/{o}/support-sessions` is any member (staff see only live sessions, with less detail) and `POST /orgs/{o}/support-sessions/{s}/revoke` is the real owner. Requesting a support session is limited to 30 an hour per person.

Tables written: `organisations` (status, `support_access_allowed`), `platform_admins`, `platform_settings`, `support_access_sessions`.

### Cover (`backend/src/Mod/Cover.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/cover/overview` | `overview` |  |
| GET | `/orgs/{o}/cover/open` | `openShifts` |  |
| GET | `/orgs/{o}/cover/mine` | `mine` |  |
| GET | `/orgs/{o}/cover/shifts/{s}/candidates` | `candidates` |  |
| POST | `/orgs/{o}/cover/shifts/{s}/apply` | `apply` |  |
| POST | `/orgs/{o}/cover/shifts/{s}/assign` | `assign` |  |
| POST | `/orgs/{o}/cover/requests` | `createRequest` |  |
| POST | `/orgs/{o}/cover/requests/{r}/cancel` | `cancelRequest` |  |
| POST | `/orgs/{o}/cover/applications/{a}/withdraw` | `withdrawApplication` |  |
| POST | `/orgs/{o}/cover/applications/{a}/approve` | `approveApplication` |  |
| POST | `/orgs/{o}/cover/applications/{a}/reject` | `rejectApplication` |  |
| POST | `/orgs/{o}/cover/absences` | `reportAbsence` |  |
| POST | `/orgs/{o}/cover/absences/{a}/withdraw` | `withdrawAbsence` |  |
| POST | `/orgs/{o}/cover/absences/{a}/dismiss` | `dismissAbsence` |  |

What it does: Cover: absence reports, cover requests, applications, the manager's cover board and ranked candidates with their eligibility reasons. An absence report is a person saying they cannot work one of their own future published shifts; a cover request takes the person off the shift and offers it to eligible people.

Access: Every route first refuses a platform support session (403) and answers 403 `feature_off` while the `cover_tools` flag is off (both after membership, so a stranger still gets 404). `overview` and `candidates` are owner or manager. `open`, `mine`, `apply`, `absences`, `absences/{a}/withdraw` and `applications/{a}/withdraw` are any member with a staff record (writes also need a writable organisation); an unpublished draft does not exist for staff (404). Creating or cancelling a cover request, `assign`, approving or rejecting an application and dismissing an absence are owner or manager, on a writable organisation and a plan that is not read-only; approval re-checks eligibility under the organisation lock and a second approval for the same shift is 409.

Tables written: `cover_absences`, `cover_requests`, `cover_applications`, `shifts`.

### Enquiries (`backend/src/Mod/Enquiries.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/enquiries` | `receive` | public raw |
| GET | `/platform/enquiries` | `inbox` |  |
| POST | `/platform/enquiries/{e}/status` | `setStatus` |  |

What it does: Website enquiries (the contact form) and the platform's inbox for them. The raw address is never stored, only a keyed hash; the notice to the team is sent by cron and carries no visitor text.

Access: `POST /enquiries` is public and raw and defends itself (section 5; fields `name`, `organisation`, `workEmail`, `message`, optional `teamSize`, `sector`, `wantsDemo`, `marketingConsent`, `turnstileToken` and the honeypot `website`). `GET /platform/enquiries` and `POST /platform/enquiries/{e}/status` are platform owner, admin or support.

Tables written: `enquiries`.

### FeatureFlags (`backend/src/Mod/FeatureFlags.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/features` | `mine` |  |
| GET | `/platform/flags` | `list` |  |
| GET | `/platform/flags/changes` | `changes` |  |
| POST | `/platform/flags` | `set` |  |
| POST | `/platform/flags/targets` | `target` |  |

What it does: Platform feature switches: what is on for an organisation, and the platform console's control of flags (`enabled`, `rollout`, target plans), pilot organisations and the change log. Flags exist by migration only; there is no create endpoint.

Access: `GET /orgs/{o}/features` is any member (the effective features for the organisation). `GET /platform/flags` and `GET /platform/flags/changes` are any platform role; `POST /platform/flags` and `POST /platform/flags/targets` are platform owner or admin (404 for others).

Tables written: `feature_flags`, `feature_flag_targets`, `feature_flag_changes`.

### Gdpr (`backend/src/Mod/Gdpr.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/gdpr` | `list` |  |
| POST | `/platform/gdpr` | `log` |  |
| POST | `/platform/gdpr/{g}/status` | `setStatus` |  |
| POST | `/platform/gdpr/{g}/extend` | `extend` |  |
| GET | `/orgs/{o}/gdpr` | `orgList` |  |
| POST | `/me/data-requests` | `requestMine` |  |
| GET | `/me/data-requests` | `mine` |  |
| POST | `/orgs/{o}/staff/{s}/erase` | `eraseStaff` |  |

What it does: Data-subject requests and erasure. Platform staff keep a register of requests (one month to answer, extendable); a person can also ask for their own data. Closing an erasure request as completed queues the person's login for deletion from Clerk and then locally, and is refused while the person is the only owner of an organisation or still holds a platform role. Erasing a staff member's data keeps their rota history on an anonymous row (`Gdpr::ERASURE_CLEARED` and `Gdpr::ERASURE_RETAINED` list the columns).

Access: `GET /platform/gdpr`, `POST /platform/gdpr` and `.../status` are platform owner, admin or support; `.../extend` is platform owner or admin; a caller without the platform role gets 404. `GET /orgs/{o}/gdpr` and `POST /orgs/{o}/staff/{s}/erase` are the real owner (a delegate cannot), erase also writable. `POST /me/data-requests` is any signed-in person for `access`, `portability`, `rectification` or `erasure`; an `org_id` in the body must be one they belong to (403); at most 5 open requests and 10 an hour per person. `GET /me/data-requests` lists the caller's own requests.

Tables written: `gdpr_requests`, `account_deletions`, `storage_deletions`, `staff_profiles`, `emergency_contacts`, `calendar_feed_tokens`, `documents`, `cover_absences`, `cover_applications`, `support_access_sessions` and `users` (erasure and the `Gdpr::cron` login deletion).

### Incidents (`backend/src/Mod/Incidents.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/incidents` | `list` |  |
| GET | `/platform/incidents/{i}` | `show` |  |
| POST | `/platform/incidents` | `declare` |  |
| POST | `/platform/incidents/{i}/updates` | `update` |  |
| POST | `/platform/incidents/{i}/resolve` | `resolve` |  |

What it does: The platform status record: declaring an incident, posting updates on its timeline and resolving it.

Access: All five routes are platform owner, admin or support; a caller without the role gets 404. Declaring is limited to 30 an hour per person.

Tables written: `incidents`, `incident_updates`, `incident_counter`.

### Invites (`backend/src/Mod/Invites.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/invites` | `list` |  |
| POST | `/orgs/{o}/invites` | `create` |  |
| POST | `/orgs/{o}/invites/{i}/revoke` | `revoke` |  |
| POST | `/orgs/{o}/invites/{i}/resend` | `resend` |  |
| POST | `/invites/preview` | `preview` | public |
| POST | `/invites/accept` | `accept` |  |

What it does: Join links: a 32-byte token shown once, only its SHA-256 stored, redeemed by a signed-in person whose verified email equals the invited address.

Access: List, create, revoke and resend are owner or manager (effective role); create and resend also need a writable organisation, and resending an owner invitation is refused (403: owner invitations are issued by the platform). `POST /invites/preview` is public (30 a minute per address, authorised by the token). `POST /invites/accept` is any signed-in person; a different verified email is 403 `invite_email_mismatch`; every failure to redeem looks the same so a token cannot be probed. Invitation limits: 60 an hour per organisation, 10 accepts an hour per person.

Tables written: `invites`, `memberships` (accepting). Mail goes out through `Mail::forOrg`.

### LabourCost (`backend/src/Mod/LabourCost.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/labour-cost` | `labourCost` |  |
| GET | `/orgs/{o}/pay-rates/current` | `currentRates` |  |

What it does: Labour cost without exposing anybody's rate: the cost of shifts on published or archived rotas that are not cancelled, using the rate in force on the day of each shift, and the current rates.

Access: Both routes are owner or manager (effective role).

Tables written: none (read only).

### Leave (`backend/src/Mod/Leave.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/leave` | `listLeave` |  |
| POST | `/orgs/{o}/leave` | `createLeave` |  |
| POST | `/orgs/{o}/leave/{l}/review` | `reviewLeave` |  |
| POST | `/orgs/{o}/leave/{l}/cancel` | `cancelLeave` |  |
| GET | `/orgs/{o}/overtime` | `listOvertime` |  |
| POST | `/orgs/{o}/overtime` | `createOvertime` |  |
| POST | `/orgs/{o}/overtime/{v}/review` | `reviewOvertime` |  |
| POST | `/orgs/{o}/overtime/{v}/cancel` | `cancelOvertime` |  |
| GET | `/orgs/{o}/overtime/evidence` | `evidence` |  |
| GET | `/orgs/{o}/attention` | `attention` |  |

What it does: Leave and overtime requests, their review and cancellation, overtime evidence, and the `attention` counts of pending leave, overtime and swaps (organisation-wide for a manager, the person's own for anyone else).

Access: Reads and creates are any member: a manager may act for any person, anyone else only for their own staff record (403 `forbidden` otherwise, 403 `no_staff_record` when the caller has none); creates also need a writable organisation. `leave/{l}/review` and `overtime/{v}/review` are owner or manager and writable and take `status` of `approved` or `rejected`; with the `scheduling_tools` flag on an approval also lists the person's shifts that now clash. Cancel is the person or a manager. `overtime/evidence` is the person or a manager. Fields of `POST /orgs/{o}/leave`: `start_date`, `end_date`, `type` (default `holiday`, at most 40 characters), `starts_half` and `ends_half` (true for a half day), `reason` (at most 1000 characters), `staff_profile_id` (default: the caller's own) and `client_event_id`. A second live booking on the same day is 409 `leave_overlap`, checked under a row lock on the person's staff record.

Tables written: `leave_requests`, `overtime_requests`.

### Lifecycle (`backend/src/Mod/Lifecycle.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/deletion-preview` | `orgPreview` |  |
| POST | `/orgs/{o}/delete` | `orgDelete` |  |
| GET | `/platform/orgs/{o}/deletion-preview` | `platformPreview` |  |
| POST | `/platform/orgs/{o}/delete` | `platformDelete` |  |
| GET | `/platform/retention` | `retention` |  |
| POST | `/platform/retention/dry-run` | `dryRun` |  |

What it does: Deleting an organisation, finishing the file deletions an erasure or a removal owes, and retention. Deleting an organisation is immediate and cannot be undone; it needs the exact name typed, writes the audit row first, and the audit trail, support cases, data-subject requests and billing events survive detached from the tenant.

Access: `deletion-preview` and `delete` under `/orgs/{o}` are the real owner of that organisation (`confirm_name` must equal the name exactly, else 422 `name_mismatch`; 10 an hour per person). The same two under `/platform/orgs/{o}` are platform owner or admin (404 otherwise). `GET /platform/retention` is any platform role; `POST /platform/retention/dry-run` is platform owner or admin.

Tables written: `organisations` (and, by cascade or the `CLEAR_FIRST` clearing, every tenant table), `storage_deletions`; retention writes `retention_runs` and deletes by date from the tables listed in `docs/DATA-MODEL.md` section 6.

### Notifications (`backend/src/Mod/Notifications.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/notifications` | `list` |  |
| POST | `/orgs/{o}/notifications/read` | `markRead` |  |
| POST | `/me/push-subscriptions` | `subscribe` |  |
| POST | `/me/push-subscriptions/delete` | `unsubscribe` |  |

What it does: The caller's in-app inbox for one organisation and their web push subscriptions. The cron job of this module queues scheduled alerts and runs `Dispatcher::drain`, which delivers the notification outbox (in-app rows, email, web push).

Access: `GET /orgs/{o}/notifications` (takes `limit`, 1 to 100, default 50, and `unread=1`) and `POST /orgs/{o}/notifications/read` are any member and touch only the caller's own rows. `POST /me/push-subscriptions` and `.../delete` need only sign-in and act on the caller's own subscriptions; a subscription needs an `https` `endpoint` and `keys.p256dh` and `keys.auth`, 30 an hour per person.

Tables written: `notifications`, `push_subscriptions` from the routes; `Dispatcher` (run by the cron job) also writes `notification_outbox`, `notification_deliveries` and `notifications`.

### Orgs (`backend/src/Mod/Orgs.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/me` | `me` |  |
| GET | `/slug-available` | `slugAvailable` |  |
| POST | `/orgs` | `createOrg` |  |
| GET | `/orgs/{o}` | `getOrg` |  |
| POST | `/orgs/{o}` | `updateOrg` |  |
| GET | `/orgs/{o}/members` | `listMembers` |  |
| POST | `/orgs/{o}/members/{m}/role` | `setRole` |  |
| POST | `/orgs/{o}/members/{m}/status` | `setStatus` |  |
| POST | `/orgs/{o}/transfer-ownership` | `transferOwnership` |  |
| GET | `/orgs/{o}/delegations` | `listDelegations` |  |
| POST | `/orgs/{o}/delegations` | `delegate` |  |
| POST | `/orgs/{o}/delegations/{d}/revoke` | `revokeDelegation` |  |

What it does: The signed-in person (`GET /me`: user, memberships, platform role), organisations, members, ownership transfer and temporary manager cover.

Access: `GET /me` and `GET /slug-available` need only sign-in (the slug check is limited to 60 a minute per person and, with `exclude`, requires membership of that organisation). `POST /orgs` needs `org_creation` to be `open` or a platform owner or admin, otherwise 403 `org_creation_closed`; 5 an hour per person. `GET /orgs/{o}`, `GET .../members` and `GET .../delegations` are any member (a manager, including a delegate, sees more member detail). `POST /orgs/{o}` (rename) is owner and writable. Role change, status change and `transfer-ownership` are the real owner and writable (an owner keeps the owner role; an owner cannot be suspended). Creating a delegation is a real owner or manager and writable; revoking one is the lender or a real owner or manager.

Tables written: `organisations`, `memberships`, `role_delegations`.

### OrgSettings (`backend/src/Mod/OrgSettings.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/orgs/{o}/settings` | `save` |  |
| GET | `/orgs/{o}/smtp` | `getSmtp` |  |
| POST | `/orgs/{o}/smtp` | `saveSmtp` |  |
| POST | `/orgs/{o}/smtp/test` | `testSmtp` |  |
| POST | `/orgs/{o}/smtp/delete` | `deleteSmtp` |  |

What it does: Settings an owner controls: the notification matrix (5 events by 3 channels), who manages job titles, and the organisation's own mail account (the SMTP password is encrypted at rest and never returned).

Access: All five routes are owner (effective role); writes also need a writable organisation. `POST /orgs/{o}/smtp/test` is limited to 10 an hour per organisation and checks the SMTP host before connecting (and again before the test send, because DNS can change).

Tables written: `organisations` (the `settings` JSON), `org_smtp_settings`.

### Photos (`backend/src/Mod/Photos.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/orgs/{o}/staff/{s}/photo` | `upload` | upload |
| POST | `/orgs/{o}/staff/{s}/photo/delete` | `remove` |  |
| GET | `/orgs/{o}/staff/{s}/photo-link` | `link` |  |
| GET | `/files` | `serve` | public |

What it does: Staff photos in the private file store, shown through short-lived signed links so a picture is never at a guessable address. A photo is JPEG, PNG or WebP of at most 2 MiB and 4096 pixels a side, judged by its bytes and re-encoded to drop metadata.

Access: Upload and delete are the person themself or an owner or manager, on a writable organisation; `photo-link` is any member of the organisation (colleagues appear on the rota); `GET /files` is public and authorised by the signed link. Upload is the 3 MiB route and is limited to 20 an hour per person; the body field is `data`, the picture base64 encoded.

Tables written: `staff_profiles` (`photo_path`, `photo_url`), `storage_deletions`.

### Places (`backend/src/Mod/Places.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/locations` | `listLocations` |  |
| POST | `/orgs/{o}/locations` | `saveLocation` |  |
| POST | `/orgs/{o}/locations/{l}` | `saveLocation` |  |
| POST | `/orgs/{o}/locations/{l}/delete` | `deleteLocation` |  |
| GET | `/orgs/{o}/departments` | `listDepartments` |  |
| POST | `/orgs/{o}/departments` | `saveDepartment` |  |
| POST | `/orgs/{o}/departments/{d}` | `saveDepartment` |  |
| POST | `/orgs/{o}/departments/{d}/delete` | `deleteDepartment` |  |

What it does: Locations (sites with a geofence and a time zone) and the departments inside them.

Access: Any member reads; owner or manager (effective role) writes, on a writable organisation.

Tables written: `locations`, `departments`; deleting a department first clears `staff_profiles.department_id` for its people.

### Planning (`backend/src/Mod/Planning.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/shift-types` | `listTypes` |  |
| POST | `/orgs/{o}/shift-types` | `saveType` |  |
| POST | `/orgs/{o}/shift-types/{y}` | `saveType` |  |
| POST | `/orgs/{o}/shift-types/{y}/delete` | `deleteType` |  |
| GET | `/orgs/{o}/availability` | `listAvailability` |  |
| POST | `/orgs/{o}/availability` | `addAvailability` |  |
| POST | `/orgs/{o}/availability/{a}/delete` | `deleteAvailability` |  |
| GET | `/orgs/{o}/minimum-cover` | `listCover` |  |
| POST | `/orgs/{o}/minimum-cover` | `setCover` |  |

What it does: The ingredients of a rota: shift types, people's availability, and each site's minimum cover.

Access: Reads of shift types and minimum cover are any member. Writes to shift types and minimum cover are owner or manager, writable organisation, plan not read-only. Availability: a manager reads every record, anyone else their own; adding or deleting availability is the person for their own record or a manager for anyone's, on a writable organisation.

Tables written: `shift_types`, `availability`, `minimum_cover_rules`.

### Platform (`backend/src/Mod/Platform.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/platform/orgs` | `createOrg` |  |
| POST | `/platform/orgs/{o}/owner-invites` | `inviteOwner` |  |

What it does: Creating an organisation with no members and an owner invitation, and replacing the pending owner invitation while the organisation has no members.

Access: Both routes are platform owner or admin (404 for others); creating an organisation is limited to 20 an hour per person.

Tables written: `organisations`, `invites`.

### PlatformAnnouncements (`backend/src/Mod/PlatformAnnouncements.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/announcements` | `list` |  |
| POST | `/platform/announcements` | `create` |  |
| POST | `/platform/announcements/{a}/publish` | `publishNow` |  |
| POST | `/platform/announcements/{a}/cancel` | `cancel` |  |
| GET | `/orgs/{o}/platform-announcements` | `mine` |  |
| POST | `/orgs/{o}/platform-announcements/{a}/read` | `read` |  |
| POST | `/orgs/{o}/platform-announcements/opt-out` | `optOut` |  |

What it does: The platform telling organisations something: drafts, scheduled and sent announcements, delivered as one row per organisation and addressed to people through the ordinary notification outbox. Maintenance and incident notices ignore an organisation's opt-out; product, billing and policy notices respect it.

Access: `GET /platform/announcements` is any of the four platform roles; create, `publish` and `cancel` are platform owner or admin (404 for others; publishing is limited to 20 an hour per person). `GET /orgs/{o}/platform-announcements` and `.../{a}/read` are owner or manager of the organisation; `opt-out` is the real owner.

Tables written: `platform_announcements`, `platform_announcement_deliveries`, `platform_announcement_optouts`; delivery queues rows in `notification_outbox`.

### PlatformAudit (`backend/src/Mod/PlatformAudit.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/audit` | `search` |  |

What it does: The platform's read of the audit trail: every entry, across organisations. A tenant owner reads their own organisation's trail through `GET /orgs/{o}/audit` and never platform-only entries.

Access: Platform owner, admin or support; finance reads none (404 for everyone else).

Tables written: none (read only).

### PlatformBilling (`backend/src/Mod/PlatformBilling.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/billing/summary` | `summary` |  |
| GET | `/platform/invoices` | `invoices` |  |
| GET | `/platform/invoices/{i}/credits` | `credits` |  |
| POST | `/platform/invoices/{i}/credits` | `credit` |  |
| GET | `/orgs/{o}/invoices/{i}/credits` | `orgCredits` |  |

What it does: The platform's view of revenue and invoices (monthly recurring revenue per currency, what was collected and what is owed) and invoice credits: a record against an invoice, in the invoice's currency, that changes nothing else.

Access: The four `/platform` routes are platform owner, admin or finance (404 for others; support is excluded). `GET /orgs/{o}/invoices/{i}/credits` is the real owner of the organisation.

Tables written: `invoice_credits`.

### Rotas (`backend/src/Mod/Rotas.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/rotas` | `list` |  |
| POST | `/orgs/{o}/rotas` | `create` |  |
| POST | `/orgs/{o}/rotas/{r}` | `rename` |  |
| POST | `/orgs/{o}/rotas/{r}/publish` | `publish` |  |
| POST | `/orgs/{o}/rotas/{r}/unpublish` | `unpublish` |  |
| POST | `/orgs/{o}/rotas/{r}/revision` | `beginRevision` |  |
| POST | `/orgs/{o}/rotas/{r}/discard` | `discardRevision` |  |
| POST | `/orgs/{o}/rotas/{r}/repeat` | `repeat` |  |

What it does: Rotas and their lifecycle: a draft, then published, then archived when an amendment replaces it. A published or archived rota is never edited; an amendment is a draft copy that supersedes it, and publishing it archives the original in the same transaction.

Access: Listing is any member, but staff see only published and archived rotas, never a draft. Every write (create, rename, publish, unpublish, revision, discard, repeat) goes through one guard: owner or manager (effective role), a writable organisation, and a plan that is not read-only (402 `billing_read_only`). `POST /orgs/{o}/rotas/{r}/publish` takes no body field: the rota is in the path; it answers 409 `rota_not_draft`, `shift_overlap` (with the `scheduling_tools` flag on) or `cover_below_minimum`, and queues a rota-published notification. `unpublish` is refused with 409 `open_amendment` while an amendment is open. `repeat` copies a rota's shifts into the next 1 to 26 weeks, skipping weeks that are published or already have shifts.

Tables written: `rotas` and `shifts` (the `repeat` copy and the discard of an amendment).

### Scheduling (`backend/src/Mod/Scheduling.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/rotas/{r}/publish-preview` | `preview` |  |
| POST | `/orgs/{o}/rotas/{r}/patterns/generate` | `generate` |  |

What it does: Scheduling tools: a publish preview with warnings (rest, weekly hours, leave clash, declared unavailability) and recurring patterns that fill one draft rota (at most 92 days and 500 shifts per generation). Warnings never block; a double booking does, when the module is on.

Access: Owner or manager (effective role), and the `scheduling_tools` flag must be on for the organisation, else 403 `feature_off` (checked after membership). Writes (`patterns/generate`) also need a writable organisation and a plan that is not read-only; `publish-preview` is a read.

Tables written: `shifts` (`patterns/generate`; with `preview: true` the generation is rolled back).

### Shifts (`backend/src/Mod/Shifts.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/shifts` | `list` |  |
| POST | `/orgs/{o}/shifts` | `create` |  |
| POST | `/orgs/{o}/shifts/batch` | `createBatch` |  |
| POST | `/orgs/{o}/shifts/{h}` | `update` |  |
| POST | `/orgs/{o}/shifts/{h}/delete` | `delete` |  |

What it does: Shifts. A published rota is immutable and an archived one is history, so a write goes only into a draft rota; every write takes the rota's row lock so it queues behind a publish of the same rota.

Access: `GET /orgs/{o}/shifts` is any member: published and archived rotas' shifts plus loose shifts that belong to no rota; an owner or manager also reads drafts. Create, batch (at most 500 shifts), update and delete are owner or manager (effective role), writable organisation and a plan that is not read-only; a shift in a published or archived rota answers 409 `rota_published` or `rota_archived`.

Tables written: `shifts`.

### Staff (`backend/src/Mod/Staff.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/job-titles` | `listTitles` |  |
| POST | `/orgs/{o}/job-titles` | `saveTitle` |  |
| POST | `/orgs/{o}/job-titles/{t}` | `saveTitle` |  |
| POST | `/orgs/{o}/job-titles/{t}/delete` | `deleteTitle` |  |
| GET | `/orgs/{o}/staff` | `listStaff` |  |
| POST | `/orgs/{o}/staff` | `createStaff` |  |
| GET | `/orgs/{o}/staff/{s}` | `getStaff` |  |
| POST | `/orgs/{o}/staff/{s}` | `updateStaff` |  |
| POST | `/orgs/{o}/staff/{s}/locations` | `setLocations` |  |
| GET | `/orgs/{o}/staff/{s}/pay-rates` | `listRates` |  |
| POST | `/orgs/{o}/staff/{s}/pay-rates` | `addRate` |  |
| GET | `/orgs/{o}/staff/{s}/emergency-contacts` | `listContacts` |  |
| POST | `/orgs/{o}/staff/{s}/emergency-contacts` | `saveContact` |  |
| POST | `/orgs/{o}/staff/{s}/emergency-contacts/{c}` | `saveContact` |  |
| POST | `/orgs/{o}/staff/{s}/emergency-contacts/{c}/delete` | `deleteContact` |  |

What it does: Staff records, the job-title catalogue, site assignment, pay rates and emergency contacts. A column rule replaces the old column grants: every member reads names, titles, departments, hours, skills and photo; payroll id, start date, phone, email and holiday allowance go only to an owner or manager (including a delegate) and to the person themselves.

Access: Reads of job titles, the staff list and one staff record are any member (with the column rule above). Creating a record, setting locations and adding a pay rate are owner or manager. `POST /orgs/{o}/staff/{s}` is a manager, or the person themselves limited to their phone (403 `self_edit_restricted` otherwise). Pay-rate reads and every emergency-contact route are a manager or the person (`managerOrSelf`); writes also need a writable organisation. Job-title writes are the owner, or a manager when the organisation setting `job_titles_managed_by` is `managers`; anyone else is 403.

Tables written: `staff_profiles`, `job_titles`, `staff_locations`, `staff_pay_rates`, `emergency_contacts`.

### StripeWebhook (`backend/src/Mod/StripeWebhook.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/stripe/webhook` | `receive` | public raw |

What it does: The Stripe webhook: the only way a payment changes an organisation. Public by necessity, so it authorises itself (section 5 sets out the steps).

Access: Public and raw: no sign-in; authorised by the `Stripe-Signature` header for the configured mode. 300 a minute per address like every public route.

Tables written: `billing_events`, `invoices`, and the subscription state and `organisations` plan through `backend/src/Billing.php`.

### Support (`backend/src/Mod/Support.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/support/cases` | `open` |  |
| GET | `/support/cases` | `mine` |  |
| GET | `/support/cases/{c}` | `show` |  |
| POST | `/support/cases/{c}/reply` | `reply` |  |
| POST | `/support/cases/{c}/rate` | `rate` |  |
| GET | `/platform/support/cases` | `queue` |  |
| POST | `/platform/support/cases/{c}/status` | `setStatus` |  |
| POST | `/platform/support/cases/{c}/assign` | `assign` |  |
| GET | `/platform/support/sla` | `sla` |  |
| POST | `/platform/support/sla` | `saveSla` |  |

What it does: The support desk. A customer opens a case and replies; platform staff (owner, admin, support; finance is not operational) answer, assign, set status and keep internal notes. A case is visible to the person who raised it, to an owner of its organisation, and to operational staff; a case you may not see is a plain 404.

Access: `POST /support/cases`, `GET /support/cases`, `GET /support/cases/{c}`, `reply` and `rate` need only sign-in and then the visibility rule above; `rate` is only the person who raised the case; an internal note is staff only (403). `GET /platform/support/cases`, `status`, `assign` and `GET /platform/support/sla` are platform owner, admin or support; `POST /platform/support/sla` is platform owner or admin (404 for others). Fields of `POST /support/cases/{c}/reply`: `body` (required, at most 10000 characters) and `internal` (boolean, staff only); 60 an hour per person. Opening a case takes `subject` (at most 200), `body` (at most 10000), `category`, `priority`, optional `org_id`, and, for staff only, `requester_email`; 10 an hour per person.

Tables written: `support_cases`, `support_case_messages`, `support_counter` (reference numbers), `support_sla_targets`.

### Swaps (`backend/src/Mod/Swaps.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/swaps` | `list` |  |
| POST | `/orgs/{o}/swaps` | `create` |  |
| GET | `/orgs/{o}/swaps/options` | `options` |  |
| POST | `/orgs/{o}/swaps/{w}/respond` | `respond` |  |
| POST | `/orgs/{o}/swaps/{w}/claim` | `claim` |  |
| POST | `/orgs/{o}/swaps/{w}/cancel` | `cancel` |  |
| POST | `/orgs/{o}/swaps/{w}/decide` | `decide` |  |
| POST | `/orgs/{o}/swaps/{w}/reassign` | `reassign` |  |
| GET | `/orgs/{o}/open-shifts` | `openShifts` |  |
| POST | `/orgs/{o}/open-shifts/{h}/claim` | `claimOpenShift` |  |

What it does: Shift swaps and the open-shift board. A swap offers one of your shifts to a named colleague or to the open board; the colleague (or whoever claims it) accepts, then the requester or a manager finalises, and approving moves the shift in one transaction. Both write into a published rota on purpose. With the cover module on, a swap whose shift changed or started is cancelled automatically.

Access: Every route is any member with a writable organisation for writes; the acts differ. Creating a swap needs a staff record (403 `no_staff_record`), and a manager may create one for another person. `respond` is the colleague it was offered to, while pending. `claim` and `open-shifts/{h}/claim` need a staff record. `cancel` is the requester or a manager. `decide` is a manager, or the requester once the colleague has accepted (403 otherwise). `reassign` is a manager or the requester. `GET /orgs/{o}/swaps/options` and a swap that asks for a shift in return need the `two_way_swaps` flag (403 `feature_off`). The instant open-shift claim takes the organisation lock first and checks cover eligibility whatever the flag. Fields of `POST /orgs/{o}/swaps`: `shift_id` (required), `requested_by` (default: the caller's own staff record), `target_staff_profile_id` (none means the open board), `take_shift_id` (two-way), `note` (at most 1000 characters) and `client_event_id`.

Tables written: `shift_swaps`, `shifts` (approving or claiming moves a shift).

### Templates (`backend/src/Mod/Templates.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/notification-templates` | `list` |  |
| POST | `/platform/notification-templates` | `save` |  |
| POST | `/platform/notification-templates/delete` | `delete` |  |

What it does: The wording of notification emails, written by platform owners and admins: a platform-wide row, or one for a single organisation, which wins. Only placeholders the `Dispatcher` fills may appear.

Access: Platform routes. A caller without the platform role gets 404 (`Templates::staff`). The list is platform owner, admin or support; save and delete are platform owner or admin.

Tables written: `notification_templates`.

### Timesheets (`backend/src/Mod/Timesheets.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/timesheets` | `list` |  |
| GET | `/orgs/{o}/timesheets/export` | `export` |  |
| POST | `/orgs/{o}/timesheets/export` | `exportAndMark` |  |
| POST | `/orgs/{o}/timesheets/submit` | `submit` |  |
| POST | `/orgs/{o}/timesheets/approve` | `approve` |  |
| POST | `/orgs/{o}/timesheets/{t}/reopen` | `reopen` |  |

What it does: Timesheets: one decision per person per period, a submit and approve flow, and, behind the `timesheet_tools` flag, flag lines beside each shift, the payroll CSV export (GET reads, POST marks the included approved periods `exported`) and the owner's reopening of an exported period.

Access: `GET /orgs/{o}/timesheets` is any member (a manager reads everyone's, anyone else their own). `submit` is any member with a staff record, on a writable organisation. `approve` and `reopen` are owner or manager and writable; a manager or delegate cannot approve their own hours (403 `own_timesheet`; an owner may). Reopening an exported period needs the flag on and the owner role and a reason. Both export routes are owner or manager, never a platform support session (403), and 403 `feature_off` while the flag is off; the POST also needs a writable organisation and is not refused for a read-only plan. Fields of `POST /orgs/{o}/timesheets/approve`: `period_start`, `period_end` and `approvals`, a list of at most 500 objects each with `staff_profile_id` and `total_minutes`; the batch is all or nothing and a re-approval replaces the figure and bumps `version`. Fields of the export: `period_start` and `period_end`.

Tables written: `timesheets`, `timesheet_reopenings`.

## 5. Webhooks and inbound

### Stripe webhook (`POST /stripe/webhook`, `backend/src/Mod/StripeWebhook.php`)

Public and raw: the handler receives the exact bytes and headers, because the signature is over the bytes.

1. **Mode.** Only the mode set in private configuration (`stripe.mode`, `test` or `live`) is served. An event whose `livemode` is the other mode is acknowledged with `{"received":true,"ignored":"mode"}` and never acted on. With no mode or no webhook secret configured the answer is **503** `billing_unavailable`.
2. **Signature.** `BillingRules::verifySignature` (`backend/src/BillingRules.php`): HMAC-SHA256 over the exact bytes, header `Stripe-Signature`, with a 300-second tolerance, against that mode's own secret (settings `stripe.test_webhook_secret` and `stripe.webhook_secret`; names only). A bad signature is **400** `bad_signature`; an event that is not a Stripe event is **400** `bad_event`.
3. **Once per mode.** Each event is recorded in `billing_events` (unique on provider, mode and event id); a redelivery of a processed event answers `{"received":true,"duplicate":true}` and does nothing twice.
4. **Never trust the payload.** A subscription is re-fetched from Stripe, because events arrive out of order; every write is pinned to one subscription the system holds, in one mode.
5. **Events handled:** `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`.
6. **Failure.** A processing failure answers **500** `webhook_failed` so Stripe redelivers, with the error class recorded in `billing_events.last_error`; a deliberate non-action answers 200 with a note in the ledger.

Whether the live site is in Stripe test or live mode is `NOT VERIFIED` (server configuration); the header of `backend/src/StripeClient.php` says RotaFlow runs in test mode until the owner switches it.

### Public enquiry (`POST /enquiries`, `backend/src/Mod/Enquiries.php`)

Public and raw. It defends itself in this order: the `Origin` header (when present) must be one of the app origins (the app URL, its `www.` form and the private setting `enquiry_origins`), content type `application/json`, at most 16384 bytes, JSON object, a honeypot field `website` (a filled one gets the success reply and writes nothing), field validation (`name`, `organisation`, `message`, `workEmail`, optional `teamSize`, `sector`, `wantsDemo`, `marketingConsent`),
Cloudflare Turnstile when `turnstile_secret` is configured (the token is `turnstileToken`), then 5 requests an hour per address (a keyed hash, never the raw address) and 100 an hour overall. Success is **201** `{"ok":true}`. The row goes to `enquiries`; a notice to the team is sent later by cron, carrying no visitor text.

### Other inbound

- **Calendar feed** `GET /ics?token=...` (`backend/src/Mod/CalendarFeed.php`) and **stored files** `GET /files` and `GET /document-files` (`backend/src/Mod/Photos.php`, `backend/src/Mod/Compliance.php`): public, authorised by a secret token or a signed link (section 2).
- **Invitation preview** `POST /invites/preview` (`backend/src/Mod/Invites.php`): public, limited to 30 a minute per address, authorised by the invitation token in the body.

## 6. Outbound

- **OpenRouter** (`backend/src/Mod/AiAssistant.php`, routes `POST /orgs/{o}/ai/rota` and `POST /orgs/{o}/ai/announcement`): the only AI provider; the endpoint is `https://openrouter.ai/api/v1/chat/completions`; settings `openrouter_api_key`, `openrouter_model` (default `openai/gpt-4o-mini`) and the optional `openrouter_fallback_model` (names only). Staff are sent as aliases (`S1`, `S2`, ...) without names (`backend/src/AiStaffAliases.php`); approved leave is sent as dates only, never its type; the manager's own prompt has names masked. The reply is never returned as received: `backend/src/AiGrounding.php` matches ids to real rows, snaps times to the shift type's own hours, drops overlaps and leave or unavailable days, and refuses an announcement that states a date that is in neither the period nor the manager's own words.
  The caller must be an owner or manager (never a support session), the plan must include `ai_rota_assistant`, the flag must be on, the server must hold a key, and the limits are 30 an hour per person and 200 an hour per organisation. Nothing is stored except one audit row per completed request (counts and lengths).
- **Stripe** (`backend/src/StripeClient.php`): a small cURL client, no SDK, a pinned API version, the mode explicit and a key of the other mode refused. Called from `backend/src/Mod/Billing.php` (checkout, customer portal, contact sync, invoice links) and `backend/src/Mod/StripeWebhook.php` (re-fetching a subscription).
- **Email** (`backend/src/Mail.php`): an organisation's own SMTP account if saved (`org_smtp_settings`), otherwise the platform's `smtp` private setting, otherwise none (email is skipped and the delivery log says why). `backend/src/SmtpMailer.php` is a minimal authenticated client: implicit TLS on 465, otherwise STARTTLS, certificate and host always verified, header-injection checks.
- **Web push** (`backend/src/WebPushSender.php`): RFC 8291 encryption and RFC 8292 VAPID with OpenSSL and cURL only, from the private `vapid` setting (public key, private key, subject); without all three push is reported as not configured (`backend/src/NullPusher.php`). Whether a push has ever reached a real device is `NOT VERIFIED`.
- **Clerk** (`backend/src/Mod/Gdpr.php`): after an erasure case closes, cron deletes the Clerk user through `https://api.clerk.com/v1/users/<id>` with the private `clerk_secret_key`; the queue waits while the key is missing.
- **Cloudflare Turnstile** (`backend/src/Mod/Enquiries.php`): the token is verified against Cloudflare's `siteverify` endpoint when `turnstile_secret` is configured.
- **SMS:** no code exists (`notifications.channel` has a reserved `sms` value only).

## 7. Legacy: Edge Functions and RPCs

The Edge Function and RPC contracts of the retired Supabase back end are in the previous version of this document, `git show live-supabase-2026-11-01:docs/API-SPEC.md`, and the function sources stay in `supabase/functions` until Phase 6.
The 12 legacy Edge Functions and what replaced each:

| Legacy function | Replacement in the PHP API |
| --- | --- |
| `ai-rota-assistant` | `backend/src/Mod/AiAssistant.php`: `POST /orgs/{o}/ai/rota` and `POST /orgs/{o}/ai/announcement` |
| `billing-account` | `backend/src/Mod/Billing.php`: `GET /orgs/{o}/billing` |
| `calendar-feed` | `backend/src/Mod/CalendarFeed.php`: public `GET /ics`, with issue and revoke routes |
| `create-checkout-session` | `backend/src/Mod/Billing.php`: `POST /orgs/{o}/billing/checkout` |
| `create-portal-session` | `backend/src/Mod/Billing.php`: `POST /orgs/{o}/billing/portal` |
| `delete-account` | `backend/src/Mod/Gdpr.php`: a request enters through `POST /me/data-requests`; `Gdpr::cron` deletes the Clerk user and the local one once an erasure case closes |
| `public-enquiry` | `backend/src/Mod/Enquiries.php`: public `POST /enquiries` |
| `purge-storage` | `backend/src/Mod/Lifecycle.php`: `Lifecycle::cron` drains `storage_deletions` |
| `send-invite` | `backend/src/Mod/Invites.php`: `POST /orgs/{o}/invites` and `POST /orgs/{o}/invites/{i}/resend`, sending through `Mail::forOrg` |
| `send-notification` | `backend/src/Dispatcher.php`, run by `Notifications::cron` (its header says it replaces the retired function) |
| `stripe-webhook` | `backend/src/Mod/StripeWebhook.php`: public raw `POST /stripe/webhook` |
| `test-smtp` | `backend/src/Mod/OrgSettings.php`: `POST /orgs/{o}/smtp/test` |

The retired RPC contracts (Postgres functions called from the browser) are not documented here. Their PHP equivalents are the routes in section 4, guarded by the checks in `docs/DATA-MODEL.md` section 5; that the equivalence holds RPC by RPC is `NOT VERIFIED` (no RPC-by-RPC comparison was made).
