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
- **Feature flags.** A module that ships dark answers **403** `feature_off` while its flag is off for the organisation (`staff_documents`, `scheduling_tools`, `cover_tools`, `timesheet_tools`, `two_way_swaps`, `ai_rota_assistant`; see `backend/src/Flags.php`), Cover checks after the membership check so a stranger still gets 404; the order in the other modules is `NOT VERIFIED (not read in this pass)`.
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
- **Pagination.** There is no general convention. The console lists (`organisations` and `users` in `backend/src/Mod/Console.php`) take `limit` (1 to 100, default 50) and `offset` and echo both; every other list returns a fixed, capped set (for example the rota list is limited to 500 rows in `backend/src/Mod/Rotas.php`).
- **Times.** Instants are ISO 8601 with an offset; dates are `YYYY-MM-DD`; the database stores UTC.

## 4. Route reference

One subsection per module, in alphabetical order of file name. Each table is generated from the module's `routes()` array: the verb, the path under `/api`, the handler method in that module, and the tuple flag (`public`, `raw`, `upload`, `upload-document`) where there is one.
The lines under a table say what the module does, who may call it and which tables it writes.

### Account (`backend/src/Mod/Account.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/me/settings` | `getSettings` |  |
| POST | `/me/settings` | `saveSettings` |  |
| POST | `/me/profile` | `saveProfile` |  |
| POST | `/orgs/{o}/onboarding/complete` | `completeOnboarding` |  |
| GET | `/orgs/{o}/audit` | `audit` |  |
| POST | `/orgs/{o}/audit` | `record` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### AiAssistant (`backend/src/Mod/AiAssistant.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/orgs/{o}/ai/rota` | `run('rota')` |  |
| POST | `/orgs/{o}/ai/announcement` | `run('announcement')` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### CalendarFeed (`backend/src/Mod/CalendarFeed.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/calendar-feed` | `status` |  |
| POST | `/orgs/{o}/calendar-feed/issue` | `issue` |  |
| POST | `/orgs/{o}/calendar-feed/revoke` | `revoke` |  |
| GET | `/ics` | `feed` | public |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Clock (`backend/src/Mod/Clock.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/clock-events` | `list` |  |
| POST | `/orgs/{o}/clock-events` | `record` |  |
| POST | `/orgs/{o}/clock-events/{e}/delete` | `delete` |  |
| POST | `/orgs/{o}/clock-events/{e}/correct` | `correct` |  |
| GET | `/orgs/{o}/clock-events/{e}/corrections` | `corrections` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Enquiries (`backend/src/Mod/Enquiries.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/enquiries` | `receive` | public raw |
| GET | `/platform/enquiries` | `inbox` |  |
| POST | `/platform/enquiries/{e}/status` | `setStatus` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### FeatureFlags (`backend/src/Mod/FeatureFlags.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/features` | `mine` |  |
| GET | `/platform/flags` | `list` |  |
| GET | `/platform/flags/changes` | `changes` |  |
| POST | `/platform/flags` | `set` |  |
| POST | `/platform/flags/targets` | `target` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Incidents (`backend/src/Mod/Incidents.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/incidents` | `list` |  |
| GET | `/platform/incidents/{i}` | `show` |  |
| POST | `/platform/incidents` | `declare` |  |
| POST | `/platform/incidents/{i}/updates` | `update` |  |
| POST | `/platform/incidents/{i}/resolve` | `resolve` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Invites (`backend/src/Mod/Invites.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/invites` | `list` |  |
| POST | `/orgs/{o}/invites` | `create` |  |
| POST | `/orgs/{o}/invites/{i}/revoke` | `revoke` |  |
| POST | `/orgs/{o}/invites/{i}/resend` | `resend` |  |
| POST | `/invites/preview` | `preview` | public |
| POST | `/invites/accept` | `accept` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### LabourCost (`backend/src/Mod/LabourCost.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/labour-cost` | `labourCost` |  |
| GET | `/orgs/{o}/pay-rates/current` | `currentRates` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Lifecycle (`backend/src/Mod/Lifecycle.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/deletion-preview` | `orgPreview` |  |
| POST | `/orgs/{o}/delete` | `orgDelete` |  |
| GET | `/platform/orgs/{o}/deletion-preview` | `platformPreview` |  |
| POST | `/platform/orgs/{o}/delete` | `platformDelete` |  |
| GET | `/platform/retention` | `retention` |  |
| POST | `/platform/retention/dry-run` | `dryRun` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Notifications (`backend/src/Mod/Notifications.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/notifications` | `list` |  |
| POST | `/orgs/{o}/notifications/read` | `markRead` |  |
| POST | `/me/push-subscriptions` | `subscribe` |  |
| POST | `/me/push-subscriptions/delete` | `unsubscribe` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### OrgSettings (`backend/src/Mod/OrgSettings.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/orgs/{o}/settings` | `save` |  |
| GET | `/orgs/{o}/smtp` | `getSmtp` |  |
| POST | `/orgs/{o}/smtp` | `saveSmtp` |  |
| POST | `/orgs/{o}/smtp/test` | `testSmtp` |  |
| POST | `/orgs/{o}/smtp/delete` | `deleteSmtp` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Photos (`backend/src/Mod/Photos.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/orgs/{o}/staff/{s}/photo` | `upload` | upload |
| POST | `/orgs/{o}/staff/{s}/photo/delete` | `remove` |  |
| GET | `/orgs/{o}/staff/{s}/photo-link` | `link` |  |
| GET | `/files` | `serve` | public |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Platform (`backend/src/Mod/Platform.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/platform/orgs` | `createOrg` |  |
| POST | `/platform/orgs/{o}/owner-invites` | `inviteOwner` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### PlatformAudit (`backend/src/Mod/PlatformAudit.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/audit` | `search` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### PlatformBilling (`backend/src/Mod/PlatformBilling.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/billing/summary` | `summary` |  |
| GET | `/platform/invoices` | `invoices` |  |
| GET | `/platform/invoices/{i}/credits` | `credits` |  |
| POST | `/platform/invoices/{i}/credits` | `credit` |  |
| GET | `/orgs/{o}/invoices/{i}/credits` | `orgCredits` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Scheduling (`backend/src/Mod/Scheduling.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/rotas/{r}/publish-preview` | `preview` |  |
| POST | `/orgs/{o}/rotas/{r}/patterns/generate` | `generate` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Shifts (`backend/src/Mod/Shifts.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/shifts` | `list` |  |
| POST | `/orgs/{o}/shifts` | `create` |  |
| POST | `/orgs/{o}/shifts/batch` | `createBatch` |  |
| POST | `/orgs/{o}/shifts/{h}` | `update` |  |
| POST | `/orgs/{o}/shifts/{h}/delete` | `delete` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### StripeWebhook (`backend/src/Mod/StripeWebhook.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| POST | `/stripe/webhook` | `receive` | public raw |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Templates (`backend/src/Mod/Templates.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/platform/notification-templates` | `list` |  |
| POST | `/platform/notification-templates` | `save` |  |
| POST | `/platform/notification-templates/delete` | `delete` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

### Timesheets (`backend/src/Mod/Timesheets.php`)

| Verb | Path | Handler | Flag |
| --- | --- | --- | --- |
| GET | `/orgs/{o}/timesheets` | `list` |  |
| GET | `/orgs/{o}/timesheets/export` | `export` |  |
| POST | `/orgs/{o}/timesheets/export` | `exportAndMark` |  |
| POST | `/orgs/{o}/timesheets/submit` | `submit` |  |
| POST | `/orgs/{o}/timesheets/approve` | `approve` |  |
| POST | `/orgs/{o}/timesheets/{t}/reopen` | `reopen` |  |

What it does: NOT VERIFIED (not read in this pass)

Access: NOT VERIFIED (not read in this pass)

Tables written: NOT VERIFIED (not read in this pass)

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

The retired RPC contracts (Postgres functions called from the browser) are not documented here. Their PHP equivalents are the routes in section 4, guarded by the checks in `docs/DATA-MODEL.md` section 5; that the equivalence holds RPC by RPC is `NOT VERIFIED (not read in this pass)`.
