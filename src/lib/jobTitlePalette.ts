/**
 * The job-title colour catalogue (docs/DESIGN.md §2b).
 *
 * ## Why a second palette exists
 *
 * `shiftPalette.ts` colours a **shift type** — Early, Late, Night. This one
 * colours an **occupation** — Nurse, Senior Carer, Kitchen. They are different
 * facts about the same chip, and a rota that paints both in one family with
 * one legend is unreadable: a manager cannot tell whether the amber chip means
 * a late shift or a kitchen assistant. So the families are separate, each has
 * its own legend, and every badge carries a short text code as well as its
 * swatch. Colour is never the only identifier, which is also what makes the
 * grid usable for somebody who cannot see the difference.
 *
 * ## What a colour is not
 *
 * A palette entry is a **category label**. It is not a permission, not an
 * attendance state and not a conflict. "Nurse" is a job title; it grants
 * nothing. `memberships.role` is the only thing that decides what a person may
 * do, and a job title must never be read as one — a tenant is free to create a
 * title called "Owner" and it stays a description of work.
 *
 * ## Exhaustion
 *
 * Twelve, and the catalogue refuses a thirteenth active title rather than
 * quietly reusing a colour: two occupations sharing a swatch is worse than a
 * blocked form, because nothing on screen says the colour has stopped meaning
 * one thing. Extending the palette is a deliberate change here and in
 * `tailwind.config.ts` together, with the contrast and colour-vision
 * measurements redone. `docs/DESIGN.md` §2b records how.
 */

export interface JobTitleSwatch {
  /** Stable id. Stored in `job_titles.colour`, so renaming one is a migration. */
  id: string;
  label: string;
  /** The solid accent, for a 4px row rule or a legend dot. */
  hex: string;
  /** Pale wash + saturated ink + hairline ring, for the badge. Written out in
   * full because Tailwind's content scan cannot see a concatenated class. */
  badgeClass: string;
  /** Solid fill, for the accent bar beside a name. */
  accentClass: string;
}

export const JOB_TITLE_PALETTE: readonly JobTitleSwatch[] = [
  {
    id: 'indigo',
    label: 'Indigo',
    hex: '#3749C8',
    badgeClass:
      'bg-role-indigo-wash text-role-indigo-ink ring-role-indigo-ink/20 dark:bg-role-indigo-deep dark:text-role-indigo-ink-dark dark:ring-role-indigo-ink-dark/25',
    accentClass: 'bg-role-indigo',
  },
  {
    id: 'sky',
    label: 'Sky',
    hex: '#29A6C8',
    badgeClass:
      'bg-role-sky-wash text-role-sky-ink ring-role-sky-ink/20 dark:bg-role-sky-deep dark:text-role-sky-ink-dark dark:ring-role-sky-ink-dark/25',
    accentClass: 'bg-role-sky',
  },
  {
    id: 'teal',
    label: 'Teal',
    hex: '#4BDDAB',
    badgeClass:
      'bg-role-teal-wash text-role-teal-ink ring-role-teal-ink/20 dark:bg-role-teal-deep dark:text-role-teal-ink-dark dark:ring-role-teal-ink-dark/25',
    accentClass: 'bg-role-teal',
  },
  {
    id: 'moss',
    label: 'Moss',
    hex: '#3A954C',
    badgeClass:
      'bg-role-moss-wash text-role-moss-ink ring-role-moss-ink/20 dark:bg-role-moss-deep dark:text-role-moss-ink-dark dark:ring-role-moss-ink-dark/25',
    accentClass: 'bg-role-moss',
  },
  {
    id: 'olive',
    label: 'Olive',
    hex: '#8FC05A',
    badgeClass:
      'bg-role-olive-wash text-role-olive-ink ring-role-olive-ink/20 dark:bg-role-olive-deep dark:text-role-olive-ink-dark dark:ring-role-olive-ink-dark/25',
    accentClass: 'bg-role-olive',
  },
  {
    id: 'amber',
    label: 'Amber',
    hex: '#CFB936',
    badgeClass:
      'bg-role-amber-wash text-role-amber-ink ring-role-amber-ink/20 dark:bg-role-amber-deep dark:text-role-amber-ink-dark dark:ring-role-amber-ink-dark/25',
    accentClass: 'bg-role-amber',
  },
  {
    id: 'clay',
    label: 'Clay',
    hex: '#C27726',
    badgeClass:
      'bg-role-clay-wash text-role-clay-ink ring-role-clay-ink/20 dark:bg-role-clay-deep dark:text-role-clay-ink-dark dark:ring-role-clay-ink-dark/25',
    accentClass: 'bg-role-clay',
  },
  {
    id: 'rose',
    label: 'Rose',
    hex: '#D04C7E',
    badgeClass:
      'bg-role-rose-wash text-role-rose-ink ring-role-rose-ink/20 dark:bg-role-rose-deep dark:text-role-rose-ink-dark dark:ring-role-rose-ink-dark/25',
    accentClass: 'bg-role-rose',
  },
  {
    id: 'magenta',
    label: 'Magenta',
    hex: '#94279A',
    badgeClass:
      'bg-role-magenta-wash text-role-magenta-ink ring-role-magenta-ink/20 dark:bg-role-magenta-deep dark:text-role-magenta-ink-dark dark:ring-role-magenta-ink-dark/25',
    accentClass: 'bg-role-magenta',
  },
  {
    id: 'violet',
    label: 'Violet',
    hex: '#925BCD',
    badgeClass:
      'bg-role-violet-wash text-role-violet-ink ring-role-violet-ink/20 dark:bg-role-violet-deep dark:text-role-violet-ink-dark dark:ring-role-violet-ink-dark/25',
    accentClass: 'bg-role-violet',
  },
  {
    id: 'slate',
    label: 'Slate',
    hex: '#4B5571',
    badgeClass:
      'bg-role-slate-wash text-role-slate-ink ring-role-slate-ink/20 dark:bg-role-slate-deep dark:text-role-slate-ink-dark dark:ring-role-slate-ink-dark/25',
    accentClass: 'bg-role-slate',
  },
  {
    id: 'cocoa',
    label: 'Cocoa',
    hex: '#6E4A49',
    badgeClass:
      'bg-role-cocoa-wash text-role-cocoa-ink ring-role-cocoa-ink/20 dark:bg-role-cocoa-deep dark:text-role-cocoa-ink-dark dark:ring-role-cocoa-ink-dark/25',
    accentClass: 'bg-role-cocoa',
  },
] as const;

export const JOB_TITLE_PALETTE_SIZE = JOB_TITLE_PALETTE.length;

/**
 * The badge a title with no colour, or an unrecognised one, wears.
 *
 * Neutral and labelled, never a silently reused palette entry. A title whose
 * colour has been removed from the palette must not start looking like a
 * different occupation.
 */
export const JOB_TITLE_FALLBACK: Omit<JobTitleSwatch, 'id' | 'label' | 'hex'> = {
  badgeClass:
    'bg-surface-subtle text-content-muted ring-surface-border dark:bg-surface-subtle-dark dark:text-content-muted-dark dark:ring-surface-border-dark',
  accentClass: 'bg-content-muted/45 dark:bg-content-muted-dark/35',
};

export function jobTitleSwatch(
  colourId: string | null | undefined,
): JobTitleSwatch | null {
  if (!colourId) return null;
  return JOB_TITLE_PALETTE.find((swatch) => swatch.id === colourId) ?? null;
}

export function jobTitleBadgeClass(colourId: string | null | undefined): string {
  return jobTitleSwatch(colourId)?.badgeClass ?? JOB_TITLE_FALLBACK.badgeClass;
}

export function jobTitleAccentClass(colourId: string | null | undefined): string {
  return jobTitleSwatch(colourId)?.accentClass ?? JOB_TITLE_FALLBACK.accentClass;
}

/**
 * Normalise a title name for uniqueness.
 *
 * Case-insensitive, whitespace-collapsed, so "Senior Carer", "senior carer"
 * and "Senior  Carer " are the same title. The *display* name is whatever was
 * typed; only the comparison form is folded. This mirrors the generated column
 * and unique index in `0127`, so the picker refuses what the database would
 * refuse rather than letting a user fill in a form and then fail.
 */
export function normaliseJobTitleName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A short text code for a title, so the badge is readable without colour.
 *
 * Initials of the first two words ("Senior Carer" → "SC"), else the first two
 * letters ("Nurse" → "NU"). Deliberately not unique: it is a reading aid
 * beside the full name, not an identifier.
 */
export function jobTitleCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '--';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
}

/** Palette entries not already taken by an active title, in palette order. */
export function availableSwatches(
  usedColourIds: readonly string[],
  keep?: string | null,
): JobTitleSwatch[] {
  const used = new Set(usedColourIds.filter((id) => id !== keep));
  return JOB_TITLE_PALETTE.filter((swatch) => !used.has(swatch.id));
}

/** The next free colour, or `null` when the palette is exhausted. */
export function nextFreeSwatch(usedColourIds: readonly string[]): JobTitleSwatch | null {
  return availableSwatches(usedColourIds)[0] ?? null;
}
