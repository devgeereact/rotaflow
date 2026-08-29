import { supabase } from '@/lib/supabase';
import type { Membership, Organisation, OrganisationUpdate } from '@/types';

export interface MyMembership extends Membership {
  organisation: Organisation;
}

/** Normalise a name into a URL-safe slug. No random suffix. The user owns it. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'org'
  );
}

/**
 * Is this slug free?
 *
 * Cannot be answered with a SELECT: the RLS policy on `organisations` only
 * exposes orgs the caller belongs to, so a taken slug looks free to everyone
 * outside that org. Backed by a SECURITY DEFINER function that returns a
 * boolean and nothing else, so it cannot be used to enumerate tenants.
 */
export async function isSlugAvailable(
  slug: string,
  /**
   * An organisation to ignore — the one the caller is editing. Onboarding
   * creates the org at the end of step 1, so re-entering that step re-checks a
   * slug the caller now owns; without this it reports their own brand-new
   * identifier as taken. The database verifies the caller actually owns this
   * org before honouring it (0060), so it cannot be used to probe.
   */
  excludeOrgId?: string | null,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('slug_available', {
    p_slug: slug,
    ...(excludeOrgId ? { p_exclude_org_id: excludeOrgId } : {}),
  });
  if (error) throw error;
  return data === true;
}

/** Every active organisation the current user belongs to, with role. */
export async function listMyMemberships(userId: string): Promise<MyMembership[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('*, organisation:organisations(*)')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) throw error;
  return data ?? [];
}

/**
 * Every active member's user_id, for fanning a notification out to the whole
 * org (e.g. a published announcement). Excludes the given user (typically the
 * author) so publishing something doesn't notify yourself about it.
 */
export async function listOrgMemberUserIds(
  orgId: string,
  excludeUserId?: string,
): Promise<string[]> {
  let query = supabase
    .from('memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (excludeUserId) query = query.neq('user_id', excludeUserId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => row.user_id);
}

/**
 * Every active member's `user_id` → `role`, for labelling who wrote something.
 * `profiles` is select-own-only under RLS, so a member's *name* comes from
 * `staff_profiles` (org-readable) and only their role comes from here.
 */
export async function listOrgMemberRoles(orgId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.user_id, row.role]));
}

/**
 * Owner-only (`memberships_write`, 0002). Demoting or promoting the last
 * owner is refused by `memberships_keep_one_owner_trigger` (0047), not by
 * this function — the database is the actual boundary, this just surfaces
 * whatever it raises.
 */
export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: 'owner' | 'manager' | 'staff',
): Promise<void> {
  const { error } = await supabase
    .from('memberships')
    .update({ role })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Owner-only. Removing the last owner is refused the same way as demoting one (0047). */
export async function removeMember(orgId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw error;
}

export interface CreateOrganisationInput {
  name: string;
  /** Defaults to a slugified name when omitted. */
  slug?: string;
  /**
   * A real column (0023), not a `settings` key. It is what the admin console
   * reads, and writing it into the jsonb instead is what left that column
   * null for every tenant — see BUG-026.
   */
  industry?: string | null;
  /** Merged into the org's `settings` jsonb (size, locale…). */
  settings?: Record<string, unknown>;
}

/**
 * Create a new organisation. The `on_org_created` trigger (0002_rotaflow.sql)
 * makes the creator an active owner automatically.
 */
export async function createOrganisation(
  input: CreateOrganisationInput | string,
  createdBy: string,
): Promise<Organisation> {
  // Kept callable with a bare name so existing callers don't have to change.
  const normalised: CreateOrganisationInput =
    typeof input === 'string' ? { name: input } : input;

  const { data, error } = await supabase
    .from('organisations')
    .insert({
      name: normalised.name,
      slug: normalised.slug?.trim() || slugify(normalised.name),
      industry: normalised.industry ?? null,
      settings: (normalised.settings ?? {}) as never,
      created_by: createdBy,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/** Fetch a single organisation by id, for a settings/edit form. */
export async function getOrganisation(orgId: string): Promise<Organisation> {
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error) throw error;
  return data;
}

/** Patch an organisation. Owners only, enforced by RLS. */
export async function updateOrganisation(
  orgId: string,
  patch: OrganisationUpdate,
): Promise<Organisation> {
  const { data, error } = await supabase
    .from('organisations')
    .update(patch)
    .eq('id', orgId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Merge keys into `settings` without clobbering the rest of the object.
 * Read-modify-write is safe here: onboarding is single-user, single-session.
 */
export async function mergeOrgSettings(
  orgId: string,
  patch: Record<string, unknown>,
): Promise<Organisation> {
  const { data: current, error: readError } = await supabase
    .from('organisations')
    .select('settings')
    .eq('id', orgId)
    .single();

  if (readError) throw readError;

  const merged = { ...((current?.settings as Record<string, unknown>) ?? {}), ...patch };
  return updateOrganisation(orgId, { settings: merged as never });
}
