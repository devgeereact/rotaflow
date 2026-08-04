import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILE_TABS, SETTINGS_TABS } from '@/lib/settingsTabs';
import { rotaWorkspaceTabs, teamWorkspaceTabs } from '@/lib/workspaceTabs';
import { FOOTER_COLUMNS, MARKETING_NAV } from '@/lib/marketing';
import { SEARCH_ENTRIES } from '@/lib/globalSearch';
import { navItemsForRole } from '@/lib/sidebarNav';
import { ADMIN_NAV, ADMIN_SECONDARY_NAV, adminNavForRole } from '@/lib/adminNav';

/**
 * Every tab must point at a route that exists.
 *
 * ## The bug this exists to prevent, which already happened once
 *
 * `settingsTabs.ts` shipped with fourteen routes and a unit test asserting the
 * tab *list* was correct. It was — and not one of those fourteen routes was
 * ever added to `App.tsx`. Nothing imported the module except its own test, so
 * every entry resolved to the `*` catch-all and rendered the 404 page.
 *
 * Typecheck, lint, format, build and the existing suite were all green
 * throughout, because a route is a string and a `<Route path>` is a string, and
 * nothing had ever compared the two. That is exactly the class of gap this
 * repository's audit keeps finding: four shape gates and no test of the thing
 * that actually breaks.
 *
 * So this test reads the real route table out of `App.tsx` and checks the tabs
 * against it. It is deliberately a source-text parse rather than a render:
 * mounting the router would need a Supabase session, an org and a role, and
 * the question here is purely "does this path have a Route" — which the source
 * answers directly and cannot drift from.
 */

const APP_TSX = path.join(process.cwd(), 'src/App.tsx');

/**
 * Pull every routable path out of `App.tsx`, resolving relative children onto
 * the prefix of the layout route that actually encloses them.
 *
 * The nesting is resolved by tracking each `<Route>`'s depth, not by string
 * prefixing. An earlier draft simply emitted `/app/settings/<segment>` for
 * every relative segment it saw anywhere, which made two of these assertions
 * pass against a tree that did not contain the routes at all — the top-level
 * `/app/notifications` was enough to satisfy `/app/settings/notifications`.
 * A test that reports success for a route that does not exist is worse than
 * no test, so the prefix has to come from the real enclosing element.
 */
interface RouteTag {
  index: number;
  segment: string;
  selfClosing: boolean;
}

/**
 * Find a `<Route …>` tag's own closing bracket.
 *
 * Scanning for the first `>` does not work: `element={<SettingsLayout />}` is
 * an attribute *value*, and its `/>` would be mistaken for the end of the
 * Route tag — which silently reclassifies every parent layout route as
 * self-closing and detaches its children. So the scan tracks JSX brace depth
 * and only accepts a bracket found at depth zero.
 */
function readTag(source: string, start: number): RouteTag {
  let depth = 0;
  let inString: string | null = null;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i]!;

    if (inString) {
      if (char === inString) inString = null;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) {
      const tagText = source.slice(start, i);
      const pathMatch = /\bpath="([^"]*)"/.exec(tagText);
      return {
        index: i,
        segment: pathMatch?.[1] ?? '',
        selfClosing: source[i - 1] === '/',
      };
    }
  }

  throw new Error(`Unterminated <Route> tag at offset ${start}`);
}

/**
 * Pull every routable path out of `App.tsx`, resolving relative children onto
 * the prefix of the layout route that actually encloses them.
 *
 * Nesting is resolved from real tag structure, not string prefixing. An
 * earlier draft emitted `/app/settings/<segment>` for every relative segment
 * it saw anywhere, which made two assertions pass against a tree that did not
 * contain those routes — top-level `/app/notifications` was enough to satisfy
 * `/app/settings/notifications`. A test that reports success for a route that
 * does not exist is worse than no test.
 */
function routeTable(): string[] {
  const source = readFileSync(APP_TSX, 'utf8');
  const routes = new Set<string>();
  const stack: string[] = [];

  for (let i = 0; i < source.length; i += 1) {
    if (source.startsWith('</Route>', i)) {
      stack.pop();
      i += '</Route>'.length - 1;
      continue;
    }
    if (!source.startsWith('<Route', i)) continue;

    const tag = readTag(source, i);
    const parent = stack[stack.length - 1] ?? '';
    const resolved = tag.segment.startsWith('/')
      ? tag.segment
      : tag.segment === ''
        ? parent
        : `${parent}/${tag.segment}`.replace(/\/{2,}/g, '/');

    if (tag.segment !== '') routes.add(resolved);
    if (!tag.selfClosing) stack.push(resolved);
    i = tag.index;
  }

  return [...routes];
}

const ROUTES = routeTable();

function isRoutable(target: string): boolean {
  const wanted = target.replace(/\/$/, '');
  return ROUTES.some((route) => {
    const declared = route.replace(/\/$/, '');
    if (declared === '*') return false;
    const declaredSegments = declared.split('/');
    const wantedSegments = wanted.split('/');
    if (declaredSegments.length !== wantedSegments.length) return false;
    return declaredSegments.every(
      (segment, i) => segment.startsWith(':') || segment === wantedSegments[i],
    );
  });
}

describe('navigation targets', () => {
  it('parses a non-trivial route table out of App.tsx', () => {
    // Guards the parser itself: if the regex stops matching, every assertion
    // below would pass vacuously against an empty table.
    expect(ROUTES.length).toBeGreaterThan(20);
    expect(ROUTES).toContain('/app/dashboard');
    expect(ROUTES).toContain('/login');
  });

  it.each(SETTINGS_TABS.map((tab) => [tab.label, tab.to] as const))(
    'Settings tab %s (%s) has a route',
    (_label, to) => {
      expect(isRoutable(to)).toBe(true);
    },
  );

  it.each(PROFILE_TABS.map((tab) => [tab.label, tab.to] as const))(
    'Profile tab %s (%s) has a route',
    (_label, to) => {
      expect(isRoutable(to)).toBe(true);
    },
  );

  it('routes the Settings and Profile area roots', () => {
    expect(isRoutable('/app/settings')).toBe(true);
    expect(isRoutable('/app/account')).toBe(true);
  });

  /*
   * The merged workspaces (Rota = build + published, Team = directory +
   * availability). Both roles are checked because the tab sets differ: a
   * manager gets both halves, staff get only the half they may open, and a tab
   * pointing at a route that does not exist would 404 for one role while
   * looking fine for the other.
   */
  it.each(
    (['owner', 'manager', 'staff'] as const).flatMap((role) =>
      [...rotaWorkspaceTabs(role), ...teamWorkspaceTabs(role)].map(
        (tab) => [role, tab.label, tab.to] as const,
      ),
    ),
  )('workspace tab for %s — %s (%s) has a route', (_role, _label, to) => {
    expect(isRoutable(to)).toBe(true);
  });

  it('gives staff no workspace tab they cannot open', () => {
    // A single-item set renders no tab bar at all (WorkspaceHeader), which is
    // the intended outcome — not an empty bar, and not a link to a 403.
    expect(rotaWorkspaceTabs('staff')).toHaveLength(1);
    expect(teamWorkspaceTabs('staff')).toHaveLength(1);
    expect(rotaWorkspaceTabs('staff')[0]?.to).toBe('/app/schedule');
    expect(teamWorkspaceTabs('staff')[0]?.to).toBe('/app/availability');
  });

  /*
   * The marketing site has exactly the same failure mode the Settings tab bar
   * had, and it is worse here: a 404 behind a nav item on a *public* page is
   * seen by prospective customers, not by staff who already signed up. These
   * links are also the first thing a search crawler follows.
   */
  it.each(MARKETING_NAV.map((link) => [link.label, link.to] as const))(
    'marketing nav item %s (%s) has a route',
    (_label, to) => {
      expect(isRoutable(to)).toBe(true);
    },
  );

  const footerLinks = FOOTER_COLUMNS.flatMap(({ heading, links }) =>
    links.map((link) => [`${heading} › ${link.label}`, link.to] as const),
  );

  it.each(footerLinks)('footer link %s (%s) has a route', (_label, to) => {
    expect(isRoutable(to)).toBe(true);
  });

  /*
   * Global search is navigation with no visible list to proofread: an entry
   * pointing at a dead route looks perfectly normal until someone picks it and
   * lands on the 404. That is the same failure the Settings tab bar shipped
   * with, so it gets the same guard.
   */
  it.each(SEARCH_ENTRIES.map((entry) => [entry.label, entry.to] as const))(
    'search entry %s (%s) has a route',
    (_label, to) => {
      expect(isRoutable(to)).toBe(true);
    },
  );

  /*
   * The sidebar is the primary navigation, and every one of its targets was
   * rewritten to NEW_STRUCTURE §4's order and spelling — "Staff" became "Team"
   * at a new URL, Clock In moved, Integrations was added. A rename that misses
   * its route is a dead link on the most-used control in the app, so all three
   * roles are checked, not just the manager's superset.
   */
  const sidebarLinks = (['owner', 'manager', 'staff'] as const).flatMap((role) =>
    navItemsForRole(role).map((item) => [`${role} › ${item.label}`, item.to] as const),
  );

  it('builds a non-trivial sidebar for every role', () => {
    expect(navItemsForRole('owner').length).toBeGreaterThan(10);
    expect(navItemsForRole('staff').length).toBeGreaterThan(5);
  });

  it.each(sidebarLinks)('sidebar item %s (%s) has a route', (_label, to) => {
    expect(isRoutable(to)).toBe(true);
  });

  it('puts the team directory at the spec spelling, with the old one aliased', () => {
    // §10/§34 name /app/team. /app/staff must keep resolving — links to it
    // have already been sent to staff.
    expect(isRoutable('/app/team')).toBe(true);
    expect(isRoutable('/app/staff')).toBe(true);
    expect(navItemsForRole('manager').map((i) => i.to)).toContain('/app/team');
  });

  /*
   * Platform administration is seven routes nobody outside the team ever
   * clicks, which is exactly why a dead one could sit there unnoticed. Same
   * guard as the sidebar.
   */
  it.each(ADMIN_NAV.map((item) => [item.label, item.to] as const))(
    'platform admin item %s (%s) has a route',
    (_label, to) => {
      expect(isRoutable(to)).toBe(true);
    },
  );

  it('routes every platform administration screen §34 names', () => {
    for (const path of [
      '/admin',
      '/admin/organisations',
      '/admin/users',
      '/admin/subscriptions',
      '/admin/billing',
      '/admin/support',
      '/admin/audit',
      '/admin/feature-flags',
      '/admin/settings',
    ]) {
      expect(isRoutable(path)).toBe(true);
    }
  });

  it('routes the platform detail screens the console links to', () => {
    // Hard-coded rather than derived: nothing in ADMIN_NAV points at these,
    // they are only reached from a row in a table. That is exactly how a
    // detail route goes missing without anything noticing.
    expect(isRoutable('/admin/organisations/some-uuid')).toBe(true);
    expect(isRoutable('/admin/users/some-uuid')).toBe(true);
  });

  it('keeps platform administration out of the tenant sidebar', () => {
    // §2: Super Admin is a platform-level permission, not a membership role.
    // An /admin entry in the org sidebar would imply otherwise to every owner.
    for (const role of ['owner', 'manager', 'staff'] as const) {
      expect(navItemsForRole(role).some((i) => i.to.startsWith('/admin'))).toBe(false);
    }
  });

  it.each(ADMIN_SECONDARY_NAV.map((item) => [item.label, item.to] as const))(
    'platform console secondary item %s (%s) has a route',
    (_label, to) => {
      // These deliberately leave the console — documentation and support are
      // marketing routes. That is exactly why they need checking: nothing else
      // in the console links to them, so a rename would go unnoticed.
      expect(isRoutable(to)).toBe(true);
    },
  );

  it('gives every platform role a console it can actually navigate', () => {
    // Role filtering hides entries; it must never produce a dead one, and it
    // must never leave a role with nothing but the overview. `null` covers an
    // administrator whose granular grant could not be read — they still get
    // the unrestricted screens rather than an empty sidebar.
    for (const role of [
      'platform_owner',
      'platform_admin',
      'platform_support',
      'platform_finance',
      null,
    ] as const) {
      const items = adminNavForRole(role);
      expect(items.length).toBeGreaterThan(1);
      for (const item of items) expect(isRoutable(item.to)).toBe(true);
    }
  });

  it('restricts billing and feature flags to the roles that may write them', () => {
    // Mirrors the has_platform_role(...) lists in 0015 onward. A support
    // administrator shown a billing screen full of empty tables would
    // reasonably conclude the product is broken.
    const support = adminNavForRole('platform_support').map((i) => i.to);
    expect(support).not.toContain('/admin/billing');
    expect(support).not.toContain('/admin/feature-flags');

    const finance = adminNavForRole('platform_finance').map((i) => i.to);
    expect(finance).toContain('/admin/billing');
    expect(finance).not.toContain('/admin/feature-flags');

    expect(adminNavForRole('platform_owner').map((i) => i.to)).toEqual(
      ADMIN_NAV.map((i) => i.to),
    );
  });

  it('routes every public entry point the marketing pages link to', () => {
    // Hard-coded rather than derived: these are the CTA destinations written
    // inline in the hero, the pricing cards and the final call to action. If
    // one is renamed, this fails rather than the button silently 404ing.
    for (const target of ['/', '/signup', '/login', '/contact', '/resources']) {
      expect(isRoutable(target)).toBe(true);
    }
  });
});
