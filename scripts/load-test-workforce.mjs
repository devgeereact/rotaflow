#!/usr/bin/env node
/**
 * Measure the workforce reads against a dataset above the API row cap.
 *
 * `docs/SAAS.md` GAP-071. `fetchAllPages` (`src/lib/pagination.ts`) makes the
 * clock, shift and rota reads complete rather than truncated, and
 * `src/lib/pagination.test.ts` proves the paging arithmetic. Neither is a
 * measurement: until this script ran, "complete above the cap" was a property
 * of the code and nobody had watched it read 50,000 rows.
 *
 * What it does, in order:
 *
 *   1. Refuses to run against anything but a stack on this machine. The
 *      service-role key can write to any project it is given, and a load test
 *      that seeded a customer's database would be the worst possible way to
 *      learn that.
 *   2. Seeds one synthetic organisation over the service role: 20 locations,
 *      250 staff, 10,000 shifts across 12 weeks and 50,000 clock events, plus
 *      an owner account with a password.
 *   3. Signs that owner in through GoTrue and re-runs the SAME PostgREST
 *      queries the services issue, as `authenticated`, so RLS, the row cap and
 *      the role's `statement_timeout` all apply exactly as they do in the app.
 *   4. Reports request count, rows, bytes and elapsed time per read, and exits
 *      non-zero if any read errored or came back short.
 *
 * The queries are written out rather than imported from `src/services`,
 * deliberately: those modules construct a browser Supabase client at module
 * scope, and importing one here would build a second client against a second
 * URL. The shape below is asserted against the service source by
 * `scripts/load-test-workforce.test.mjs`'s sibling unit test — see
 * `src/lib/pagination.test.ts` for the arithmetic and
 * `docs/PWA-RELEASE-GATES.md` for where the numbers are recorded.
 *
 * Usage:
 *
 *   supabase start
 *   eval "$(supabase status -o env | sed 's/^/export /')"
 *   node scripts/load-test-workforce.mjs
 *
 * Environment: API_URL and SERVICE_ROLE_KEY, both printed by
 * `supabase status -o env`. Nothing is read from `.env`.
 */

const API_URL = process.env.API_URL ?? process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.ANON_KEY ?? SERVICE_ROLE_KEY;

if (!API_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Set API_URL and SERVICE_ROLE_KEY. Both are printed by `supabase status -o env`.',
  );
  process.exit(2);
}

// A load test writes tens of thousands of rows. Point it at a hosted project
// by accident and there is no undo, so the host is checked rather than trusted.
{
  const host = new URL(API_URL).hostname;
  const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!local) {
    console.error(
      `Refusing to run against ${host}. This script seeds tens of thousands of rows and is for a local disposable stack only.`,
    );
    process.exit(2);
  }
}

/** The acceptance set named in GAP-071. */
const SCALE = {
  locations: 20,
  staff: 250,
  shifts: 10_000,
  clockEvents: 50_000,
};

/** PostgREST's own cap. `fetchAllPages` uses the same number. */
const PAGE_SIZE = 1000;

const stamp = Date.now();
const OWNER_EMAIL = `loadtest-${stamp}@example.test`;
const OWNER_PASSWORD = `Loadtest-${stamp}-Passw0rd`;

let requestCount = 0;
let byteCount = 0;

async function rest(path, { method = 'GET', token, body, headers = {} } = {}) {
  requestCount += 1;
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: token === SERVICE_ROLE_KEY ? SERVICE_ROLE_KEY : ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  byteCount += text.length;
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 400)}`);
  }
  return {
    rows: text ? JSON.parse(text) : [],
    contentRange: response.headers.get('content-range'),
    bytes: text.length,
  };
}

const uuid = () => crypto.randomUUID();

/** Insert in batches. One 50,000-row request is a different test from the app's. */
async function insertAll(table, rows, batch = 1000, token = SERVICE_ROLE_KEY) {
  for (let i = 0; i < rows.length; i += batch) {
    await rest(table, {
      method: 'POST',
      token,
      body: rows.slice(i, i + batch),
      headers: { Prefer: 'return=minimal' },
    });
  }
}

/**
 * Create the owner account and its organisation.
 *
 * Split out of `seed` because the sign-in has to happen between the two: the
 * organisation must exist before the owner's membership does, and the
 * membership must exist before a token carrying it can write clock events.
 */
async function createOwner() {
  const response = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      email_confirm: true,
    }),
  });
  if (!response.ok)
    throw new Error(`admin/users -> ${response.status} ${await response.text()}`);
  return { ownerUserId: (await response.json()).id };
}

async function seed(tokenForClockEvents, owner) {
  const ownerUserId = owner.ownerUserId;
  const orgId = uuid();
  const started = Date.now();

  await insertAll('organisations', [
    {
      id: orgId,
      name: `Load test ${stamp}`,
      slug: `load-test-${stamp}`,
      timezone: 'Europe/London',
      created_by: ownerUserId,
      // Enterprise, because `0070` caps sites and seats per plan and the
      // default plan allows ONE site. Seeding 20 locations on the default plan
      // fails with P0001 "Your plan includes 1 site" — which is the control
      // working, not a bug, and is the reason this is set explicitly rather
      // than left to the default.
      plan: 'enterprise',
    },
  ]);
  // No membership insert. `0048`/`0049` bootstrap the creator's owner
  // membership from a trigger on `organisations`, so writing one here returns
  // 23505 on `memberships_org_id_user_id_key`. Asserting it instead, because a
  // load test that quietly ran as a non-member would measure an empty RLS view
  // and report three complete reads of nothing.
  {
    const { rows } = await rest(
      `memberships?select=role,status&org_id=eq.${orgId}&user_id=eq.${ownerUserId}`,
      { token: SERVICE_ROLE_KEY },
    );
    if (rows[0]?.role !== 'owner') {
      throw new Error(
        `expected the organisation bootstrap to make the creator an owner, got ${JSON.stringify(rows)}`,
      );
    }
  }

  // --- locations, one per timezone-plausible site ------------------------
  const locationIds = Array.from({ length: SCALE.locations }, () => uuid());
  await insertAll(
    'locations',
    locationIds.map((id, i) => ({
      id,
      org_id: orgId,
      name: `Site ${String(i + 1).padStart(2, '0')}`,
      timezone: 'Europe/London',
      status: 'active',
    })),
  );

  // --- job titles, so the catalogue join is exercised too ----------------
  const titleIds = Array.from({ length: 8 }, () => uuid());
  await insertAll(
    'job_titles',
    titleIds.map((id, i) => ({
      id,
      org_id: orgId,
      name: `Role ${i + 1}`,
      active: true,
    })),
  );

  // --- staff -------------------------------------------------------------
  const staffIds = Array.from({ length: SCALE.staff }, () => uuid());
  await insertAll(
    'staff_profiles',
    staffIds.map((id, i) => ({
      id,
      org_id: orgId,
      first_name: 'Staff',
      last_name: String(i + 1).padStart(4, '0'),
      job_title_id: titleIds[i % titleIds.length],
      active: true,
    })),
  );

  // --- twelve published weekly rotas, one per week -----------------------
  const WEEKS = 12;
  const weekStart = (n) => {
    const d = new Date(Date.UTC(2026, 0, 5)); // a Monday
    d.setUTCDate(d.getUTCDate() + n * 7);
    return d;
  };
  const rotaIds = Array.from({ length: WEEKS }, () => uuid());
  await insertAll(
    'rotas',
    rotaIds.map((id, n) => {
      const start = weekStart(n);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      return {
        id,
        org_id: orgId,
        location_id: locationIds[n % locationIds.length],
        name: `Week ${n + 1}`,
        period_start: start.toISOString().slice(0, 10),
        period_end: end.toISOString().slice(0, 10),
        status: 'published',
        published_at: new Date().toISOString(),
      };
    }),
  );

  // --- shifts ----------------------------------------------------------
  //
  // Generated staff-major, one shift every other day, so that no person ever
  // holds two shifts starting at the same instant. That matters: `0115`'s
  // sequence guard refuses an `in` whose previous event within five minutes
  // was also an `in`, and two same-instant shifts for one person produce
  // exactly that pair. Seeding it would measure the guard rather than the read.
  const SHIFTS_PER_STAFF = Math.floor(SCALE.shifts / SCALE.staff);
  const shifts = [];
  for (let s = 0; s < SCALE.staff; s += 1) {
    for (let j = 0; j < SHIFTS_PER_STAFF; j += 1) {
      const dayOffset = j * 2;
      const week = Math.floor(dayOffset / 7) % WEEKS;
      const start = weekStart(Math.floor(dayOffset / 7));
      start.setUTCDate(start.getUTCDate() + (dayOffset % 7));
      start.setUTCHours(7 + (s % 3), 0, 0, 0);
      const end = new Date(start);
      end.setUTCHours(end.getUTCHours() + 8);
      shifts.push({
        id: uuid(),
        org_id: orgId,
        rota_id: rotaIds[week],
        location_id: locationIds[(s + j) % locationIds.length],
        staff_profile_id: staffIds[s],
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        break_minutes: 30,
        status: 'assigned',
      });
    }
  }
  await insertAll('shifts', shifts);

  // --- clock events ------------------------------------------------------
  //
  // Four per shift — in, break_start, break_end, out — so every session is
  // closed, then a second in/out pair on as many shifts as it takes to reach
  // the target. An open session left dangling is a different test (it is what
  // `pairClockEvents` flags as `missing_clock_out`) and is covered by
  // `src/lib/hours.test.ts`; here it would only mean the seed refused itself.
  const events = [];
  const push = (shift, minutes, type) => {
    events.push({
      org_id: orgId,
      staff_profile_id: shift.staff_profile_id,
      shift_id: shift.id,
      type,
      event_at: new Date(
        new Date(shift.starts_at).getTime() + minutes * 60_000,
      ).toISOString(),
      method: 'manual',
      synced: true,
    });
  };
  for (const shift of shifts) {
    push(shift, 0, 'in');
    push(shift, 180, 'break_start');
    push(shift, 210, 'break_end');
    push(shift, 480, 'out');
  }
  for (const shift of shifts) {
    if (events.length >= SCALE.clockEvents) break;
    push(shift, 600, 'in');
    push(shift, 720, 'out');
  }
  // Written as the OWNER, not over the service role.
  //
  // `0068`'s `clock_events_guard_event_at` replaces any `event_at` more than
  // 72 hours old with `now()` — for everyone except an owner or manager, who
  // are amending attendance and must be able to write a historical time. The
  // service role holds no org role, so seeding twelve weeks of history over it
  // silently collapses every one of the 50,000 events onto the same instant,
  // and `0115` then refuses the second `in` with CLK01. That is both guards
  // behaving exactly as designed; the seed has to be an owner.
  await insertAll('clock_events', events, 1000, tokenForClockEvents);

  return {
    orgId,
    ownerUserId,
    seedMs: Date.now() - started,
    seeded: {
      locations: locationIds.length,
      staff: staffIds.length,
      shifts: shifts.length,
      clockEvents: events.length,
    },
  };
}

async function signIn() {
  const response = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  if (!response.ok)
    throw new Error(`sign-in -> ${response.status} ${await response.text()}`);
  return (await response.json()).access_token;
}

/**
 * Page a query the way `fetchAllPages` does, and count what it cost.
 *
 * The stopping rule is the same one the app uses: a short page is the last
 * page, and a full one is not assumed to be.
 */
async function measure(label, token, buildPath, expected) {
  const started = Date.now();
  const before = { requests: requestCount, bytes: byteCount };
  const all = [];
  let error = null;

  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { rows } = await rest(buildPath(), {
        token,
        headers: { Range: `${from}-${from + PAGE_SIZE - 1}`, 'Range-Unit': 'items' },
      });
      all.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      if (all.length > 200_000) throw new Error('runaway read');
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  const complete = error === null && (expected === undefined || all.length === expected);
  return {
    label,
    rows: all.length,
    expected: expected ?? '—',
    requests: requestCount - before.requests,
    kb: Math.round((byteCount - before.bytes) / 1024),
    ms: Date.now() - started,
    status: error ? `ERROR: ${error.slice(0, 120)}` : complete ? 'complete' : 'SHORT',
  };
}

// Sign in first: the clock-event seed has to be written as the owner (see the
// comment on that insert), so the token is needed before seeding finishes.
const ownerCreated = await createOwner();
const token = await signIn();
const seedResult = await seed(token, ownerCreated);
const { orgId } = seedResult;

/**
 * Count the same predicate over the service role, so "complete" is measured
 * against the database rather than against an arithmetic guess.
 *
 * The first version of this script hardcoded the seeded counts and reported
 * `staff_profiles` SHORT at 251 of an expected 250. The extra row was correct:
 * `0121` gives the organisation's founder a staff record. An expectation
 * derived from the seed was simply wrong about the schema.
 */
async function expectedCount(path) {
  const response = await fetch(`${API_URL}/rest/v1/${path}&select=id`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  const range = response.headers.get('content-range') ?? '';
  return Number(range.split('/')[1]);
}

/**
 * Four windows, because "does it read every row" and "is that read usable"
 * are different questions and only the first one has a yes/no answer.
 *
 * The attendance workspace's default is a day. A month is a manager pulling a
 * period for approval. Five months is not a screen anybody opens; it is here
 * to show where the read stops being viable, which is the part GAP-071 asked
 * for and the part `fetchAllPages` cannot answer on its own.
 */
const WINDOWS = [
  ['one day', '2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z'],
  ['one week', '2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z'],
  ['one month', '2026-01-05T00:00:00.000Z', '2026-02-05T00:00:00.000Z'],
  ['five months', '2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
];

const results = [];

for (const [name, from, to] of WINDOWS) {
  const predicate = `clock_events?org_id=eq.${orgId}&event_at=gte.${from}&event_at=lt.${to}`;
  results.push(
    await measure(
      `clock_events, ${name}`,
      token,
      () => `${predicate}&select=*&order=event_at.asc,id.asc`,
      await expectedCount(predicate),
    ),
  );
}

// `listShiftsForPeriod` — today/tomorrow and the schedule views.
{
  const [, from, to] = WINDOWS[3];
  const predicate = `shifts?org_id=eq.${orgId}&starts_at=gte.${from}&starts_at=lt.${to}&status=neq.cancelled`;
  results.push(
    await measure(
      'shifts, five months',
      token,
      () => `${predicate}&select=*,rota:rotas(status)&order=starts_at.asc,id.asc`,
      await expectedCount(predicate),
    ),
  );
}

// `listStaff` — the directory, which the filter contract pages over.
{
  const predicate = `staff_profiles?org_id=eq.${orgId}`;
  results.push(
    await measure(
      'staff_profiles, whole org',
      token,
      () => `${predicate}&select=*&order=last_name.asc,id.asc`,
      await expectedCount(predicate),
    ),
  );
}

const failed = results.filter((r) => r.status !== 'complete');

console.log('');
console.log(`Seeded in ${(seedResult.seedMs / 1000).toFixed(1)}s:`, seedResult.seeded);
console.log('');
console.table(results);
console.log('');
console.log(
  `Total requests: ${requestCount}. Total payload: ${(byteCount / 1024 / 1024).toFixed(1)} MiB.`,
);
console.log(
  `Organisation ${orgId} is left in place; drop the stack with \`supabase stop --no-backup\`.`,
);

if (failed.length > 0) {
  console.error('');
  console.error(`${failed.length} read(s) did not return every row.`);
  process.exit(1);
}
