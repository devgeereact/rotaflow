/**
 * Short staff aliases for the AI payload (plan S3, docs/SAAS.md GAP-064).
 *
 * ## Why this exists
 *
 * Every request to OpenRouter used to carry each active staff member's full
 * name, joined by id to their shifts, approved leave dates and declared
 * unavailability. None of the rules the model is asked to follow needs a
 * name: they are all about ids, dates and hours. So the model now sees `S1`,
 * `S2` and so on, and the names are put back on this side of the wire before
 * anything reaches the manager.
 *
 * Staff profile UUIDs are aliased too, not only names. The context arrays are
 * joined by id, and an alias that replaced the name while the UUID stayed
 * would leave two identifiers for one person and nothing gained.
 *
 * ## Stable
 *
 * Aliases are assigned in staff-id order, not query order, so the same roster
 * gives the same aliases on every request. That keeps audit rows and any
 * captured request comparable from one call to the next.
 *
 * ## What it does not cover
 *
 * The manager's own prompt is free text. Full names, and first names only one
 * person has, are swapped for aliases before sending, because otherwise
 * "put Ada on nights" would stop working. A nickname, a misspelling or a
 * shared first name goes through as typed: that is the manager's own text,
 * and guessing who "Jo" is would be worse than sending it.
 *
 * No Deno globals in here, so it runs under vitest unchanged, the same as
 * `grounding.ts`.
 */

export interface AliasableStaff {
  id: string;
  first_name: string;
  last_name: string;
}

export interface StaffAliases {
  /** Staff profile id to alias, for building the context. */
  aliasFor: (staffProfileId: string) => string | undefined;
  /** Alias back to the real staff profile id, for reading the reply. */
  idFor: (alias: string) => string | undefined;
  /** Replace names in the manager's prompt with aliases. */
  maskPrompt: (text: string) => string;
  /** Replace aliases in model prose with the person's full name. */
  restoreNames: (text: string) => string;
}

const ALIAS_TOKEN = /\bS(\d{1,4})\b/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fullName(staff: AliasableStaff): string {
  return `${staff.first_name} ${staff.last_name}`.trim();
}

/**
 * Whole-word, case-sensitive replacement. Case-sensitive on purpose: a first
 * name such as "Will" or "May" is also an ordinary word, and the lower-case
 * word is far more often the ordinary one.
 */
function replaceWord(text: string, word: string, replacement: string): string {
  if (!word) return text;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`,
    'gu',
  );
  return text.replace(pattern, replacement);
}

export function buildStaffAliases(staff: readonly AliasableStaff[]): StaffAliases {
  const ordered = [...staff].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const aliasById = new Map<string, string>();
  const byAlias = new Map<string, AliasableStaff>();
  ordered.forEach((member, index) => {
    const alias = `S${index + 1}`;
    aliasById.set(member.id, alias);
    byAlias.set(alias, member);
  });

  // First names held by exactly one person. A shared one is ambiguous, so it
  // is left as the manager typed it.
  const firstNameCounts = new Map<string, number>();
  for (const member of ordered) {
    const first = member.first_name.trim();
    if (first) firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
  }

  // Longest names first, so "Ann Lee" is replaced before "Ann" could split it.
  const fullNames = ordered
    .map((member) => ({ name: fullName(member), alias: aliasById.get(member.id)! }))
    .filter((entry) => entry.name.includes(' '))
    .sort((a, b) => b.name.length - a.name.length);
  const uniqueFirstNames = ordered
    .map((member) => ({
      name: member.first_name.trim(),
      alias: aliasById.get(member.id)!,
    }))
    .filter((entry) => entry.name && firstNameCounts.get(entry.name) === 1)
    .sort((a, b) => b.name.length - a.name.length);

  return {
    aliasFor: (staffProfileId) => aliasById.get(staffProfileId),
    idFor: (alias) => byAlias.get(alias.trim())?.id,
    maskPrompt: (text) => {
      let masked = text;
      for (const { name, alias } of fullNames) masked = replaceWord(masked, name, alias);
      for (const { name, alias } of uniqueFirstNames) {
        masked = replaceWord(masked, name, alias);
      }
      return masked;
    },
    restoreNames: (text) =>
      text.replace(ALIAS_TOKEN, (token) => {
        const member = byAlias.get(token);
        return member ? fullName(member) : token;
      }),
  };
}
