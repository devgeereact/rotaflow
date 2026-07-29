import { supabase } from '@/lib/supabase';
import type { Membership, Organisation } from '@/types';

export interface MyMembership extends Membership {
  organisation: Organisation;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'org'}-${Math.random().toString(36).slice(2, 7)}`;
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
 * Create a new organisation. The `on_org_created` trigger (0002_rotaflow.sql)
 * makes the creator an active owner automatically.
 */
export async function createOrganisation(
  name: string,
  createdBy: string,
): Promise<Organisation> {
  const { data, error } = await supabase
    .from('organisations')
    .insert({ name, slug: slugify(name), created_by: createdBy })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}
