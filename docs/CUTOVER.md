# Cutover runbook: rotaflow.space from Supabase to cPanel MariaDB + Clerk

Status: **PREPARED, NOT RUN** (31 October 2026, branch `cutover/data-move`). Written for the owner. Every step is yours to
run; each has the command, the check that says it worked, and the way back. The Supabase project is never changed except
by the freeze (exactly reversible) and stays as it is until you retire it, so **every stage can roll back to the old site**.

Commands run on your Mac (zsh) in `~/Developer/Projects/rotaflow`, or on the server through `ssh cpanel` (the alias
`cpanel` = `devgeereact@premium17.web-hosting.com:21098`). `<utc>` means a stamp you type, e.g. `20261101T2000Z`.

## Go / no-go (all must be yes before step 1)

| # | Check | How |
| - | ----- | --- |
| 1 | `cutover/data-move` merged into `release/cutover` and pushed; `pnpm run check` green on it | Step 0 |
| 2 | Data move rehearsed locally: `pnpm run test:datamove` ends `DATAMOVE: all rehearsals passed` (full synthetic 65, live-shaped at 0156 28 and at 0164 18, dry runs 0157 to 0163 8 each; every one `0 failed`) | Step 0 |
| 3 | Dry run against the live Supabase (read-only) shows **0 errors**, and every warning has been read | Step 0.5 |
| 4 | cPanel database `devgeereact_rotaflow` exists, empty (0 tables), users `devgeereact_rf_app` and `devgeereact_rf_mig` (with TRIGGER) | Step 3 check |
| 5 | `~/rotaflow-private/config/config.php` and `migrate.php` exist (mode 600) with `secret_key`, `clerk_issuer` `https://clerk.rotaflow.space`, `clerk_authorized_parties` incl. `https://rotaflow.space`; optional keys (smtp, vapid, stripe test, clerk_secret_key, openrouter, turnstile) placed or knowingly left out | Step 4 |
| 6 | `php bin/doctor.php` on the server exits 0 | Step 4 |
| 7 | Clerk production instance: domain verified (all DNS green), allowed origin `https://rotaflow.space`, session claim `email`, email code only | Step 9 |
| 8 | A last `backup.yml` run or a fresh `pg_dump` younger than 26 hours exists, and you have the passphrase | Step 2 |
| 9 | Users told about the window (old console: platform announcement, kind maintenance) at least a day before | before |
| 10 | You have 2 hours, and nobody is mid-payroll (timesheets approved and exported) | before |

Any **no** = do not start. Estimated downtime (old site read-only to new site open): **60 to 90 minutes**; the data
move itself takes minutes (local rehearsal: 10,000 shifts and 3,000 audit rows in under 5 seconds).

## Inputs you provide (never committed, never pasted into chat)

| What | Where it comes from | Where it goes |
| ---- | ------------------- | ------------- |
| Supabase database URI, **session pooler, port 5432** (`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`) | Supabase, Project Settings, Database, Connection string, URI | `~/rotaflow-cutover/secrets/supabase-db-uri` (mode 600) |
| Supabase project URL `https://<ref>.supabase.co` and the **service_role** key | Supabase, Project Settings, API | URL: typed in the command; key: `~/rotaflow-cutover/secrets/service-key` (mode 600) |
| The server's runtime config (`config.php`, holds `secret_key`) | `~/rotaflow-private/config/config.php` on the server | copied to `~/rotaflow-cutover/private/config/config.php` (mode 600) for the move, deleted after |
| MariaDB passwords | your password manager | typed at the `-p` prompts only |
| Stripe test secret key and test webhook signing secret (later: live) | Stripe dashboard | the server's `config.php` `stripe` block |

```zsh
mkdir -p ~/rotaflow-cutover/{secrets,private/config,backups} && chmod 700 ~/rotaflow-cutover ~/rotaflow-cutover/*
# paste each value into its file with a text editor (not echo: shell history), then:
chmod 600 ~/rotaflow-cutover/secrets/*
```

## Step 0: the release branch (days before)

```zsh
cd ~/Developer/Projects/rotaflow
git switch release/cutover && git merge --ff-only cutover/data-move && pnpm run check && git push origin release/cutover
brew install postgresql@17          # pg_dump/psql for the backup; the move itself uses PHP's pdo_pgsql
pnpm run test:datamove              # the whole move rehearsed on throwaway databases (needs scripts/test-db.sh up)
```
Check: `check` exit 0; `DATAMOVE: ... 0 failed`. Rollback: nothing changed anywhere.

## Step 0.5: dry run against the live Supabase (read-only, any time before)

The dry run compares against the target schema, so run **step 5 (migrations on the new, empty cPanel database) first**; nothing reads that database yet, so this is safe days ahead (found 1 Nov 2026: `schema_migrations doesn't exist`).

The source connection is one `REPEATABLE READ READ ONLY` transaction: it cannot write to Supabase.
```zsh
cd ~/Developer/Projects/rotaflow
scp cpanel:rotaflow-private/config/config.php ~/rotaflow-cutover/private/config/config.php && chmod 600 ~/rotaflow-cutover/private/config/config.php
grep -c "host=localhost" ~/rotaflow-cutover/private/config/config.php     # expect 1
sed -i '' 's#mysql:host=localhost;#mysql:host=127.0.0.1;port=13306;#' ~/rotaflow-cutover/private/config/config.php
ssh -f -N -o ExitOnForwardFailure=yes -L 13306:127.0.0.1:3306 cpanel                                   # tunnel to the cPanel MariaDB
ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/datamove.php plan \
  --source-uri-file=$HOME/rotaflow-cutover/secrets/supabase-db-uri
```
Check: last line `plan: OK (0 errors, N warnings)`; open the report it names (`~/rotaflow-cutover/private/datamove/report-...-plan.md`)
and read every warning and the "Mappings applied" counts (they list, for example, people who signed in with Google only,
banned people, the legacy admin flag, documents still linking to a Supabase URL). Fix errors on Supabase, or decide; then
run it again. If the tunnel is refused (`Access denied ... '127.0.0.1'`), see "If the tunnel is refused" at the end.
Rollback: nothing was written.

### Source version: the live project is at 0156, not 0164

Found 1 November 2026 (metadata only, through Supabase's API: no data read): production's `supabase_migrations` lists
**0001 to 0156**. The repo's `supabase/migrations` goes to 0164; **0157 to 0164 were never applied there**, and the first
live `plan` stopped on `relation "public.account_deletions" does not exist`. The move now reads the version from the
source's own record (and probes the schema, which decides what the SQL may name), so any source from 0156 to 0164 works.
Do **not** apply 0157-0164 on Supabase for the move: nothing needs them, and the old project is about to be frozen.

The line just above `plan: OK ...` (and `apply:`, `verify:`) names it: `source at 0156`. The report's header has a
`Source schema:` line, and these **six warnings** are expected at 0156 (plain warnings, never errors; each is one line,
shown here without the `source at 0156:` prefix):

| Warning | What the move does (docs/AUDIT.md, A-DM-1 to A-DM-6) |
| ------- | ----------------------------------------------------- |
| the storage deletion queue (storage_deletions, added by 0159) not present, nothing to move | No file is held back as queued for deletion |
| privately stored documents (documents.storage_path, added by 0159) not present, nothing to move | Every document is a pasted link (`file_url`) and moves as one; no document file to copy (live: 0 documents) |
| privately stored staff photos (staff_profiles.photo_path, added by 0162) not present, nothing to move | Photos stay pasted links (`photo_url`); no photo file to copy |
| the erasure queue (account_deletions, added by 0162) not present, nothing to move | A completed erasure case still makes its person unlinkable, as 0162 would have (live: 0 data-protection requests) |
| personal time and week preferences (app_settings.time_format, week_start, digest_frequency, added by 0163) not present, nothing to move | Everyone gets what the app showed before 0163: 24h, monday, immediate |
| medical notes on emergency contacts (emergency_contacts.medical_notes, purged by 0164) still present, never moved: 0 rows hold a note | The column is never read or written; only a count of non-blank notes (live: 0 emergency contacts) |

Also expected, not about the version: `support_email names rotaflow.app (not ours)` if the live platform settings still
carry the migration's address. If the medical-notes line says **more than 0**, the move leaves those notes behind on
Supabase (decision D5); export them first only if you decide to (owner action O11). If a warning says an erasure case was
completed for someone who **still owns an organisation or holds a platform role**, that person is moved unlinkable: give the
role to someone else after the move. A warning that the migration record and the schema disagree means someone changed the
schema by hand; the move follows the schema, but read it before going on. Step 7 at 0156: nothing in the database points at
a stored file, so `would_copy 0`; any object in Storage is reported (other bucket or orphan) and is in the step 2 backup.

The live table listing's counts are estimates (it showed 0 plans, flags and settings beside 1 flag change and 1
announcement delivery, which their foreign keys make impossible); the plan's own `source` counts are exact. The rehearsal
`pnpm run test:datamove` builds a source from 0001-0156 only and one from 0001-0164, fills both in the live shape
(`backend/tests/datamove/seed-live-shape.sql`: 1 organisation, 2 logins, 21 staff, 311 shifts, 1,006 notifications, 381
audit rows, and 54,696 health samples, 3,018 delivery-log rows and 370 retention runs that are not moved) and runs plan,
apply, verify, a refused second apply, `--resume` and an interrupted move against each; at 0156 it then adds the pre-0164
privacy cases (`seed-before-0164.sql`) and checks them.

## Step 1: freeze writes on the old site (downtime starts)

1. Supabase dashboard, SQL editor, the RotaFlow project: paste and run `scripts/cutover/supabase-freeze.sql`.
   Check: `frozen_tables` = number of public tables minus 2; the old site still shows rotas; saving anything fails with
   "RotaFlow is moving: changes are paused".
2. Wait until `SELECT count(*) FROM notification_outbox WHERE status = 'pending';` is 0 (the drain runs on each cron run: every five minutes on the live host), at
   most 5 minutes. Then run `scripts/cutover/supabase-freeze-final.sql`.
   Check: `frozen_tables` = `public_tables`; every `rotaflow-*` cron job `active = false`; write down
   `outbox_pending_not_delivered` (those messages are not sent; normally 0).

Rollback: run `scripts/cutover/supabase-unfreeze.sql` (drops exactly what the freeze added, restores each cron job's own
state). The old site is fully back.

## Step 2: final Supabase backup (database and Storage)

```zsh
cd ~/rotaflow-cutover/backups && umask 077
PGBIN=$(brew --prefix postgresql@17)/bin
# full dump (schema + data, every schema we can read) for safekeeping
$PGBIN/pg_dump "$(cat ~/rotaflow-cutover/secrets/supabase-db-uri)" --format=custom --no-owner --no-privileges -f supabase-full-<utc>.dump
# the data the move reads, in the form scripts/datamove-test.sh restore-dump loads
$PGBIN/pg_dump "$(cat ~/rotaflow-cutover/secrets/supabase-db-uri)" --data-only --format=custom \
  --table='public.*' --table=auth.users --table=auth.identities --table=storage.buckets --table=storage.objects -f supabase-data-<utc>.dump
$PGBIN/pg_restore --list supabase-full-<utc>.dump | grep -c "TABLE DATA public"        # expect 60 or more
# every Storage object of every bucket, under its own name, with SHA256SUMS (resumable: run again if it stops)
cd ~/Developer/Projects/rotaflow && ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/datamove.php files \
  --source-uri-file=$HOME/rotaflow-cutover/secrets/supabase-db-uri --supabase-url=https://<ref>.supabase.co \
  --service-key-file=$HOME/rotaflow-cutover/secrets/service-key --backup=$HOME/rotaflow-cutover/backups/storage-<utc>
```
Check: both dumps non-empty; `pg_restore --list` count; the backup step ends `OK (0 errors)` and `listed` = `copied` +
`already_there`. Copy the folder to your offline backup disk as well. Rollback: nothing changed (read-only).

## Step 3: the cPanel database (exists since S2; check only)

```zsh
ssh cpanel 'mysql -u devgeereact_rf_mig -p devgeereact_rotaflow -e "SELECT COUNT(*) AS tables_now FROM information_schema.tables WHERE table_schema = DATABASE(); SHOW GRANTS;"'
```
Check: `tables_now` 0 (or the migration tables only, if step 5 ran before); grants include SELECT, INSERT, UPDATE, DELETE,
CREATE, ALTER, INDEX, DROP, REFERENCES, TRIGGER. If the database or a user is missing, create it in cPanel, MySQL
Databases (names above), and put the passwords into the two config files. Rollback: none needed.

## Step 4: private config and the server's PHP

```zsh
ssh cpanel 'ls -la ~/rotaflow-private ~/rotaflow-private/config'      # dirs 700, config.php and migrate.php 600
ssh cpanel 'grep -E "clerk_issuer|clerk_authorized_parties|org_creation|trust_cf" ~/rotaflow-private/config/config.php'
ssh cpanel 'php -i | grep -E "^(upload_max_filesize|post_max_size)"'  # 15M or more for 10 MB documents
```
Check: issuer `https://clerk.rotaflow.space`; parties include `https://rotaflow.space`; `trust_cf_connecting_ip` true;
`secret_key` present (`grep -c secret_key` = 1). Keys you want live now: `smtp`, `vapid` (the existing VAPID pair, so
push subscriptions moved from Supabase keep working), `stripe` with `mode` `test`, `clerk_secret_key`, `openrouter_api_key`,
`turnstile_secret` with the site key (both or neither). `doctor.php` runs after step 8 (the code is there then).
Rollback: none needed.

## Step 5: migrations 001 to 020, with a pinned backup first

The app code reaches the server with the release in step 8; the migrations can run from the Mac through the tunnel now:
```zsh
ssh cpanel 'mkdir -p ~/rotaflow-private/backups && mysqldump -u devgeereact_rf_mig -p --single-transaction --routines --triggers devgeereact_rotaflow > ~/rotaflow-private/backups/pre-migrate-<utc>.sql'
cp ~/rotaflow-cutover/private/config/config.php ~/rotaflow-cutover/private/config/migrate.php     # then edit migrate.php: user devgeereact_rf_mig and its password
cd ~/Developer/Projects/rotaflow
ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/migrate.php --dry-run   # lists 001 ... 020
ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/migrate.php             # ends "done"
```
Check: `done`; `SELECT COUNT(*) FROM schema_migrations` = 19 (001 to 020; there is no 012); `SELECT flag_key, enabled FROM
feature_flags` shows the five R2 flags at 0. The live MariaDB is 11.4: the migrations were rehearsed locally on 11.4.13
too (docs/AUDIT.md, data move). Rollback: the database is new and nothing reads it yet; to start again, drop its tables in
phpMyAdmin or restore `pre-migrate-<utc>.sql`. The old site is untouched.

## Step 6: the data move: dry run, apply, verify

```zsh
S="--source-uri-file=$HOME/rotaflow-cutover/secrets/supabase-db-uri"
ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/datamove.php plan $S     # 0 errors, the same warnings as in 0.5 (six "source at 0156" ones)
ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/datamove.php apply $S    # apply: OK
ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/datamove.php verify $S   # verify: OK
```
Leave demo organisations behind with `--exclude-demo-orgs` on all three (and on step 7), if you decide to.
Check: `apply: OK`; `verify: OK`, every table `checksum=match`, `missing=0`, `sample_diffs=0`. Keep the three reports.
If apply stops (network), run `apply --resume $S`: it skips what is there and finishes; then verify.
Rollback: the old site is still frozen and untouched; unfreeze it (step 1 rollback). The new database can be emptied
(restore `pre-migrate-<utc>.sql` and run step 5 again) before a later attempt.

## Step 7: files (staff documents and photos)

```zsh
F="$S --supabase-url=https://<ref>.supabase.co --service-key-file=$HOME/rotaflow-cutover/secrets/service-key"
ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/datamove.php files $F           # dry run: would_copy N
ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/datamove.php files --apply $F   # copied N, failed 0
ROTAFLOW_PRIVATE_ROOT=~/rotaflow-cutover/private php backend/bin/datamove.php verify $S          # also checks every file
rsync -rlt ~/rotaflow-cutover/private/uploads/ cpanel:rotaflow-private/uploads/
ssh cpanel 'find ~/rotaflow-private/uploads -type d -exec chmod 700 {} + && find ~/rotaflow-private/uploads -type f -exec chmod 600 {} +'
(cd ~/rotaflow-cutover/private/uploads && find . -type f | sort | xargs shasum -a 256) > /tmp/rf-local.sha
ssh cpanel 'cd ~/rotaflow-private/uploads && find . -type f | sort | xargs sha256sum' > /tmp/rf-server.sha
diff /tmp/rf-local.sha /tmp/rf-server.sha && echo FILES-IDENTICAL
```
Check: `failed 0` (a size or MD5 mismatch is refused, never written: run `files --apply` again); `FILES-IDENTICAL`.
Objects queued for deletion, objects nothing points to and other buckets are not copied (counted in the report; they are
in the step 2 backup). Rollback: as step 6.

## Step 8: deploy `release/cutover` with the kit release script

1. Remove the retired keys from the build environment (Vite inlines every `VITE_*` it finds):
   `cp .env ~/rotaflow-cutover/backups/env-<utc> && sed -i '' -E '/^VITE_(SUPABASE_URL|SUPABASE_ANON_KEY|ENABLE_OAUTH|IMAGEKIT_URL_ENDPOINT|IMAGEKIT_PUBLIC_KEY)=/d' .env`
2. Backups outside every web root:
   `ssh cpanel 'mkdir -p ~/private_backups/docroots ~/private_backups/configs && tar -czf ~/private_backups/docroots/rotaflow.space-pre-cutover-<utc>.tgz -C ~ rotaflow.space && cp ~/rotaflow.space/.htaccess ~/private_backups/configs/rotaflow.space-htaccess.bak-<utc>'`
3. Compose the new `.htaccess` (docs/DEPLOYMENT.md, "Composing the live `.htaccess`"): the live Cloudflare origin-lock block
   on top of the repo file of `release/cutover`.
   ```zsh
   scp cpanel:rotaflow.space/.htaccess /tmp/htaccess.live
   grep -n "Cloudflare-origin-lock" /tmp/htaccess.live              # BEGIN and END lines; stop if not both
   awk '/BEGIN Cloudflare-origin-lock/,/END Cloudflare-origin-lock/' /tmp/htaccess.live > /tmp/htaccess.lock
   awk '/BEGIN Cloudflare-origin-lock/,/END Cloudflare-origin-lock/{next}1' /tmp/htaccess.live > /tmp/htaccess.rest
   git show main:.htaccess | diff - /tmp/htaccess.rest              # expect no difference; anything else: STOP and ask
   { cat /tmp/htaccess.lock; echo; cat .htaccess; } > /tmp/htaccess.new
   head -1 /tmp/htaccess.new | grep -q "BEGIN Cloudflare-origin-lock" && grep -q "CF-RAY" /tmp/htaccess.new && grep -q "well-known" /tmp/htaccess.lock \
     && grep -q "RewriteRule ^api(/.*)?\$ api/index.php" /tmp/htaccess.new && grep -q "clerk.rotaflow.space" /tmp/htaccess.new \
     && [ "$(grep -c "Content-Security-Policy" /tmp/htaccess.new)" -ge 1 ] && ! grep -q "supabase.co" /tmp/htaccess.new && echo COMPOSED-OK
   scp /tmp/htaccess.new cpanel:rotaflow.space/.htaccess.new && ssh cpanel 'chmod 644 ~/rotaflow.space/.htaccess.new && mv ~/rotaflow.space/.htaccess.new ~/rotaflow.space/.htaccess'
   ```
4. Release (push-to-deploy stays OFF; this runs from the Mac). The release refuses a tree with files git does not
   track, and another session may be writing design skills under `.claude/skills/` (agent tooling, never uploaded).
   Hide them from git for the release only, without touching them, and un-hide them afterwards:
   ```zsh
   git status --porcelain                                    # only `?? .claude/skills/` may show; anything else: STOP
   echo '/.claude/skills/  # cutover release only' >> .git/info/exclude
   pnpm release          # dry run: checks, the build with the pk_live key, the plan of every file per part
   pnpm release --go     # snapshot of every file it changes, upload (private app, api/index.php, then the site), smoke
   ssh cpanel 'cd ~/rotaflow-private/app && ROTAFLOW_PRIVATE_ROOT=$HOME/rotaflow-private php bin/doctor.php'   # exit 0
   sed -i '' '/# cutover release only$/d' .git/info/exclude   # un-hide .claude/skills/ again
   ```
Check: the release ends "Released <sha>" with 5 smoke checks passed (`/` 200, `/api/health` `"ok":true`, `/api/me` 401
JSON, `/app/dashboard` the app shell, `/no-such-page` 404); doctor exit 0. A failed smoke restores the old files by itself.
Rollback: `pnpm release --rollback --go` (restores the files the release changed; its own smoke then reports `/api/*`,
which is expected with the old site), then `ssh cpanel 'cp ~/private_backups/configs/rotaflow.space-htaccess.bak-<utc> ~/rotaflow.space/.htaccess'`,
then unfreeze Supabase (step 1 rollback). For a complete return of the docroot, unpack the step-2 tarball over it instead.
The release never deletes on the server, so `api/` and the new hashed assets stay behind harmlessly.

## Step 9: Clerk production (check, then the first sign-in)

Clerk dashboard, RotaFlow application, **Production**:
- Domains: `rotaflow.space` verified, every DNS record green (`clerk.`, `accounts.`, `clkmail.`, the two DKIM records). In
  Cloudflare those CNAMEs must be **DNS only (grey cloud)**; `dig +short clerk.rotaflow.space CNAME` answers `frontend-api.clerk.services.`
- Allowed origins / authorised parties: `https://rotaflow.space`.
- Sessions, customise session token: `"email": "{{user.primary_email_address}}"` (set in S2). Optional, stronger: also
  `"email_verified"` from Clerk's verified-email shortcode if the editor offers one; the API refuses any session where it is false.
- User and authentication: email address with **email verification code** only; password and Google off (as now).

Then grant the first administrator **after** the data move (before it, the row would block the move):
```zsh
ssh cpanel 'cd ~/rotaflow-private/app && ROTAFLOW_PRIVATE_ROOT=$HOME/rotaflow-private php bin/grant-platform-owner.php <your email>'
```
Check: `platform owner set` (idempotent; your moved `platform_admins` row may already say so).

### How people sign in after the move

Nobody's password moves: everyone signs in with a code sent to their email. On a person's first sign-in the API links
their Clerk account to the row moved from Supabase **by their verified email only**: compared lower-case; one account per
address (a second Clerk identity with the same address is refused 409 `email_in_use`, never merged); the row keeps its
id, memberships, staff record and history. People who signed in to Supabase with **Google only** sign in the same way:
a code to the same Gmail address links them (if they no longer read that mailbox they cannot get in: a manager changes
their email on the staff record, or support re-invites them). People **deleted** on Supabase, or whose erasure was pending,
were moved under an address nobody can verify (`<id>@removed.rotaflow.invalid`): if they sign up again they get a new,
empty account. **Unconfirmed** Supabase addresses link only once the person proves that address to Clerk. **Banned**
people are listed in the report: ban the same address in Clerk, or suspend their memberships.

## Step 10: smoke checks (you, in a private window)

| Check | Expect |
| ----- | ------ |
| `curl -s https://rotaflow.space/api/health` | `{"ok":true}` with status 200 |
| `curl -s -o /dev/null -w '%{http_code}' https://rotaflow.space/api/me` and the body | 401 and a JSON `error` (not HTML) |
| `curl -s --resolve rotaflow.space:443:185.61.152.45 -o /dev/null -w '%{http_code}' https://rotaflow.space/` | 403 (origin lock intact) |
| the same for `/.well-known/security.txt` | 200 (ACME exemption intact) |
| `/login` in Chrome with DevTools open | the Clerk form, no CSP violation in the console |
| sign in with your email code | your organisations, as before; Settings, Billing shows the plan |
| Dashboard, Rota (a published week), Team, Leave, Timesheets, Approvals, Notifications, Console (Organisations, Users) | the moved data, no error banner |
| a manager and a staff member you trust sign in | their own screens; staff see the support banner only while a session is open |
| clock in and out once on a phone (GPS) | the event appears in Attendance |

Rollback: as step 8.

## Step 11: Stripe (test mode first)

Test mode: Stripe dashboard (Test mode on), Developers, Webhooks, add endpoint `https://rotaflow.space/api/stripe/webhook`
with the seven events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`,
`customer.subscription.trial_will_end`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`; put its signing
secret in `config.php` `stripe.test_webhook_secret`, `stripe.mode` `test`. Check: a test checkout from Settings, Billing
succeeds; Developers, Webhooks shows 200 responses; Console, Billing shows the event.
Live (your decision, when the test is good): add the same endpoint in live mode, put `secret_key` (sk_live) and
`webhook_secret` in `config.php`, set `mode` `live`, then disable the old Supabase `stripe-webhook` endpoint. Until then,
live events for moved subscriptions are not recorded by the new site: each one can be resent from Stripe (Events, the
event, Resend) once the live endpoint exists. Rollback: re-enable the old endpoint; set `mode` back.

## Step 12: cron and unfreeze

```zsh
ssh cpanel 'crontab -l > ~/private_backups/configs/crontab-<utc>.bak; crontab -l'
```
Add in cPanel, Cron Jobs (every minute; the live host runs it every five), exactly:
`* * * * * ROTAFLOW_PRIVATE_ROOT=$HOME/rotaflow-private /usr/local/bin/php $HOME/rotaflow-private/app/bin/cron.php >> $HOME/rotaflow-private/logs/cron.log 2>&1`
Check after 2 minutes: `ssh cpanel 'tail -5 ~/rotaflow-private/logs/cron.log'` shows runs without errors.
"Unfreeze" for the new site means nothing more to do: it has been writable since step 8. The **old** site stays frozen
(do not unfreeze it now: two live copies would drift). Post a platform announcement that RotaFlow is back.
Rollback of the cron line: remove it (restore the backup).

## After the cutover

- Keep the Supabase project frozen, not deleted, until you are satisfied (suggested: two weeks, one payroll cycle). Rolling
  back after people have written to the new site loses those writes on the old one: decide before unfreezing it.
- Delete `~/rotaflow-cutover/private/config/*.php` and the two secrets files; kill the tunnel (`pkill -f "13306:127.0.0.1:3306"`).
- Push-to-deploy (later, your decision): merge `release/cutover` into `main`, set `"branch": "main"` in `release.json`, add
  the `push:` trigger written in `.github/workflows/deploy.yml`, create the repository variables named there and the
  `CPANEL_SSH_KEY` / `CPANEL_KNOWN_HOSTS` secrets, enable Actions for the repository. Until then `pnpm release` from the Mac.
- Retire Supabase-era workflows (`backup.yml`, `auth-config.yml`) once the project is closed; add a MariaDB backup instead. `backup.yml` was retired on 13 Nov 2026 (it only ever dumped the archived Supabase project and failed every night); `auth-config.yml` is still to go. The old runbook for it is at the tag `live-supabase-2026-11-01`.
- DNS and Cloudflare: no change for the site (same domain, same origin, still proxied). Only the Clerk CNAMEs (grey) matter.

## If the tunnel is refused

cPanel MariaDB users are usually `user@localhost`; a tunnelled connection arrives as `127.0.0.1`. If step 0.5 says
`Access denied`, either allow the host `127.0.0.1` for both users (cPanel, Remote MySQL, add `127.0.0.1`: the
connection still never leaves the server), or run the move on the server: `ssh cpanel 'php -m | grep -i pdo_pgsql'` must list it and
`ssh cpanel 'timeout 5 bash -c "</dev/tcp/aws-0-<region>.pooler.supabase.com/5432" && echo open'` must say open; then copy
the secrets files to `~/rotaflow-cutover/` on the server (mode 600), run the same commands there with
`ROTAFLOW_PRIVATE_ROOT=$HOME/rotaflow-private` and `php ~/rotaflow-private/app/bin/datamove.php`, and skip the rsync in
step 7. The code must be on the server first; nothing web-reachable changes by putting it in the private folder early:
`rsync -rlt --exclude /tests/ --exclude /public/ --exclude /private/ backend/ cpanel:rotaflow-private/app/` (the release in
step 8 then finds that part already up to date).

## Table map (source -> target) and what does not carry over

The map is code: `backend/src/DataMove/Map.php` (one entry per target table, in foreign-key order, ten groups each one
transaction: identity, places, rota, time, communication, compliance, billing, platform, gdpr, audit). The tool refuses to
run if the live source has a table that is neither mapped nor skipped, and warns about any column neither carried nor
listed as dropped. Ids (UUIDs) and timestamps (UTC) are kept; money is integer pence on both sides.

| Source | Target | Notes |
| ------ | ------ | ----- |
| `auth.users` + `profiles` | `users` | Login email (lower-case) wins over a drifted profile email; `last_sign_in_at` -> `last_seen_at`; `clerk_user_id` empty until first sign-in. Only people with a profile, plus authors referenced by rotas, timesheets, corrections or credits. Deleted, pending-erasure, profile-less or email-less people get `<id>@removed.rotaflow.invalid` and no name or avatar; so does anyone whose login existed when an erasure case for their address was closed `completed` (0162's rule, applied at every source version: before 0162 closing the case left the login). An avatar that is not https is dropped |
| `organisations`, `memberships`, `invites`, `platform_admins`, `role_delegations`, `app_settings`, `push_subscriptions` | same | `last_activity_at`, `is_demo` not kept (demo orgs move unless `--exclude-demo-orgs`); invite `accepted_by`; `endpoint_hash` computed. Pending invitation links keep working (same SHA-256 scheme). Before 0163 `app_settings` has no time or week preferences: everyone gets 24h, monday, immediate |
| `locations`, `departments`, `job_titles`, `staff_profiles`, `staff_locations`, `staff_pay_rates`, `emergency_contacts` | same | `skills` text[] -> JSON array; a photo file name the private store refuses is renamed (`<clean>-<8 hex>.<ext>`, same on the file); pay-rate `note` and `created_by` LOSSY (counted); `emergency_contacts.medical_notes` (present before 0164) is **never** moved, only counted |
| `shift_types`, `rotas`, `shifts`, `availability`, `minimum_cover_rules` | same | `site_key` computed; instants kept in UTC (both 2026 clock-change nights checked) |
| `clock_events`, `clock_event_corrections`, `leave_requests`, `overtime_requests`, `shift_swaps`, `timesheets` | same | Clock times kept to the millisecond (DATETIME(3)): microseconds cut, not rounded |
| `notification_templates`, `notifications`, `announcements`, `announcement_reads`, `org_smtp_settings` | same | SMTP password encrypted with the target `secret_key` |
| `documents` | `documents` | Status `approved` (as migration 015 defines for moved rows); `mime` from the Storage object; unsafe file names renamed as for photos; a document whose link is a Supabase URL is a warning (download and upload it again). Before 0159 there is no `storage_path`: every document is a pasted link and moves as one |
| `plans`, `feature_flags`, `support_sla_targets`, `retention_policies`, `platform_settings` | reference rows | Only update what the target seeded: Stripe price ids; flag state for flags both sides know (the five R2 flags stay off); SLA minutes; platform name, support email, URL, time zone, registration. Never `maintenance_mode`; a value naming `rotaflow.app` is not copied |
| `subscriptions`, `invoices`, `invoice_credits`, `billing_events` | same | Stripe customer, subscription and invoice ids kept |
| `feature_flag_targets`, `feature_flag_changes`, `support_access_sessions`, `support_cases` (+messages), `incidents` (+updates), `enquiries`, `platform_announcements` (+deliveries, opt-outs) | same | Flags the target does not know are skipped; missing SLA due times filled; `incidents.is_public` and announcement `channel` LOSSY; enquiries marked notified (not announced again); delivery `outbox_id` cleared |
| `gdpr_requests`, `account_deletions`, `storage_deletions` | same | A pending Supabase login deletion is closed `abandoned` (the login goes with the project); an in-flight file deletion is re-queued `pending` and its file is not copied. Before 0159 (`storage_deletions`) and 0162 (`account_deletions`) the queues do not exist: nothing to move, one warning each |
| `audit_logs` | `audit_logs` | New numeric id; the source uuid, scope, actor email/name, user agent, before/after and any mapped value are kept in `metadata._moved`; severity `notice` -> `info`, visibility `both` -> `org` |
| `calendar_feed_tokens` | not moved | Old feed URLs stop; people subscribe again from Account |
| `notification_outbox`, `notification_deliveries`, `background_jobs`, `rate_limit_events`, `retention_runs`, `platform_health_*`, integrations, `platform_ip_allowlist` | not moved | Queues, logs and cut features (counted in the report) |
| `auth.sessions`, `auth.mfa_factors`, passwords | not moved | Sign-in is Clerk's |
| Storage `staff-documents`, `staff-photos` | `~/rotaflow-private/uploads/<bucket>/<org>/<person>/<file>` | Size and MD5 checked, SHA-256 manifest, resumable; other buckets only in the step 2 backup |
