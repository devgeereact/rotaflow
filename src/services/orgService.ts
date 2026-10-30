import { api, orgPath, seg } from '@/lib/api';
import { slugify } from '@/lib/slug';
import type { Organisation, OrganisationUpdate } from '@/types';

/**
 * Re-exported from `src/lib/slug.ts`, where it moved so the pure unit suite can use it without importing this
 * module. Every existing caller imports it from here; both paths are the same function.
 */
export { slugify };

/** A member row as `GET /orgs/{o}/members` returns it. Name and email are null for a staff-role caller. */
export interface OrgMember {
  id: string;
  user_id: string;
  role: 'owner' | 'manager' | 'staff';
  status: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
}

interface OrgPayload {
  org: Partial<Organisation> & {
    id: string;
    name: string;
    slug: string;
    settings: unknown;
  };
}

/** The API answers the columns it serves; the rest of the old row shape gets neutral values. */
function toOrganisation(o: OrgPayload['org']): Organisation {
  return {
    contact_email: null,
    contact_phone: null,
    country: 'United Kingdom',
    created_at: '',
    created_by: null,
    industry: null,
    is_demo: false,
    last_activity_at: null,
    onboarding_completed_at: null,
    plan: 'starter',
    status: 'active',
    support_access_allowed: false,
    suspended_at: null,
    suspended_reason: null,
    timezone: 'Europe/London',
    trial_ends_at: null,
    updated_at: '',
    ...o,
    settings: o.settings ?? {},
  };
}

/**
 * Is this slug free? The API answers a boolean and nothing else, so it cannot be used to list tenants.
 * `excludeOrgId` is the organisation being edited, whose own slug then reads as free.
 */
export async function isSlugAvailable(
  slug: string,
  excludeOrgId?: string | null,
): Promise<boolean> {
  const r = await api.get<{ available: boolean }>('/slug-available', {
    slug,
    exclude: excludeOrgId ?? undefined,
  });
  return r.available === true;
}

/** Every member of the organisation (any status). */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const r = await api.get<{ members: OrgMember[] }>(orgPath(orgId, '/members'));
  return r.members;
}

/**
 * Every active member's user_id, for fanning a notification out to the whole org. Excludes the given user
 * (typically the author) so publishing something doesn't notify yourself about it.
 */
export async function listOrgMemberUserIds(
  orgId: string,
  excludeUserId?: string,
): Promise<string[]> {
  return (await listOrgMembers(orgId))
    .filter((m) => m.status === 'active' && m.user_id !== excludeUserId)
    .map((m) => m.user_id);
}

/** Every active member's `user_id` → `role`, for labelling who wrote something. */
export async function listOrgMemberRoles(orgId: string): Promise<Map<string, string>> {
  return new Map(
    (await listOrgMembers(orgId))
      .filter((m) => m.status === 'active')
      .map((m) => [m.user_id, m.role]),
  );
}

async function membershipIdFor(orgId: string, userId: string): Promise<string> {
  const m = (await listOrgMembers(orgId)).find((row) => row.user_id === userId);
  if (!m) throw new Error('That person is not a member of this organisation.');
  return m.id;
}

/** Owner only. An owner keeps the owner role: ownership moves with `transferOwnership`. */
export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: 'owner' | 'manager' | 'staff',
): Promise<void> {
  if (role === 'owner') {
    await transferOwnership(orgId, userId);
    return;
  }
  const mid = await membershipIdFor(orgId, userId);
  await api.post(orgPath(orgId, `/members/${seg(mid)}/role`), { role });
}

/** Owner only. Removing suspends the membership (kept for the audit trail); the last owner cannot be removed. */
export async function removeMember(orgId: string, userId: string): Promise<void> {
  const mid = await membershipIdFor(orgId, userId);
  await api.post(orgPath(orgId, `/members/${seg(mid)}/status`), { status: 'suspended' });
}

export interface CreateOrganisationInput {
  name: string;
  /** Defaults to a server-chosen slug from the name when omitted. */
  slug?: string;
  industry?: string | null;
  /** Organisation preferences kept in `settings` (size, org type…). */
  settings?: Record<string, unknown>;
}

/**
 * Create a new organisation; the creator becomes its owner. Organisations are by invitation only, so outside a
 * platform administrator this answers 403 `org_creation_closed` (docs/MERGE-TARGET.md section 6).
 */
export async function createOrganisation(
  input: CreateOrganisationInput | string,
  _createdBy?: string,
): Promise<Organisation> {
  const normalised: CreateOrganisationInput =
    typeof input === 'string' ? { name: input } : input;
  const r = await api.post<{ org: { id: string } }>('/orgs', { name: normalised.name });
  const id = r.org.id;
  const patch: Record<string, unknown> = {};
  if (normalised.slug?.trim()) patch.slug = normalised.slug.trim();
  if (normalised.industry !== undefined) patch.industry = normalised.industry;
  if (Object.keys(patch).length > 0) await api.post(orgPath(id), patch);
  if (normalised.settings && Object.keys(normalised.settings).length > 0) {
    await api.post(orgPath(id, '/settings'), normalised.settings);
  }
  return getOrganisation(id);
}

/** Fetch a single organisation by id, for a settings/edit form. */
export async function getOrganisation(orgId: string): Promise<Organisation> {
  const r = await api.get<OrgPayload>(orgPath(orgId));
  return toOrganisation(r.org);
}

/** Patch an organisation's own columns (name, slug, industry, country, timezone, contact). Owner only. */
export async function updateOrganisation(
  orgId: string,
  patch: OrganisationUpdate,
): Promise<Organisation> {
  const allowed = [
    'name',
    'slug',
    'industry',
    'country',
    'timezone',
    'contact_email',
    'contact_phone',
  ] as const;
  const body: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in patch) body[key] = patch[key];
  }
  if ('settings' in patch && patch.settings && typeof patch.settings === 'object') {
    await api.post(orgPath(orgId, '/settings'), patch.settings);
  }
  if (Object.keys(body).length > 0) await api.post(orgPath(orgId), body);
  return getOrganisation(orgId);
}

/** Merge keys into `settings` without clobbering the rest: the API merges under a row lock. Owner only. */
export async function mergeOrgSettings(
  orgId: string,
  patch: Record<string, unknown>,
): Promise<Organisation> {
  await api.post(orgPath(orgId, '/settings'), patch);
  return getOrganisation(orgId);
}

/**
 * Has this organisation's setup wizard ever been finished? Returns true when unknown: a failed read must not drop
 * somebody back into a wizard they finished weeks ago.
 */
export async function isOnboardingComplete(orgId: string): Promise<boolean> {
  try {
    return (await getOrganisation(orgId)).onboarding_completed_at != null;
  } catch {
    return true;
  }
}

/** Stamp the wizard as finished. Owner only, idempotent. */
export async function completeOnboarding(orgId: string): Promise<void> {
  await api.post(orgPath(orgId, '/onboarding/complete'));
}

/**
 * Hand the organisation to another active member in one transaction. The outgoing owner becomes a manager.
 */
export async function transferOwnership(orgId: string, toUserId: string): Promise<void> {
  const mid = await membershipIdFor(orgId, toUserId);
  await api.post(orgPath(orgId, '/transfer-ownership'), { membership_id: mid });
}
