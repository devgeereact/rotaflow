/**
 * The 8-colour shift-type palette (docs/DESIGN.md §2). Shift-type colours are
 * constrained to these swatches only, never a free hex input, so chips can
 * render via a token-class lookup and never touch a raw hex in a component.
 */
export const SHIFT_PALETTE = [
  {
    hex: '#E28273',
    bgClass: 'bg-shift-clay',
    bg20Class: 'bg-shift-clay/20',
    tintClass:
      'bg-shift-tint-clay text-shift-tint-clay-fg ring-shift-tint-clay-fg/15 dark:bg-shift-deep-clay dark:text-shift-clay dark:ring-shift-clay/25',
    label: 'Clay',
  },
  {
    hex: '#C69A45',
    bgClass: 'bg-shift-amber',
    bg20Class: 'bg-shift-amber/20',
    tintClass:
      'bg-shift-tint-amber text-shift-tint-amber-fg ring-shift-tint-amber-fg/15 dark:bg-shift-deep-amber dark:text-shift-amber dark:ring-shift-amber/25',
    label: 'Amber',
  },
  {
    hex: '#86AC6A',
    bgClass: 'bg-shift-moss',
    bg20Class: 'bg-shift-moss/20',
    tintClass:
      'bg-shift-tint-moss text-shift-tint-moss-fg ring-shift-tint-moss-fg/15 dark:bg-shift-deep-moss dark:text-shift-moss dark:ring-shift-moss/25',
    label: 'Moss',
  },
  {
    hex: '#4FB39A',
    bgClass: 'bg-shift-teal',
    bg20Class: 'bg-shift-teal/20',
    tintClass:
      'bg-shift-tint-teal text-shift-tint-teal-fg ring-shift-tint-teal-fg/15 dark:bg-shift-deep-teal dark:text-shift-teal dark:ring-shift-teal/25',
    label: 'Teal',
  },
  {
    hex: '#56AACD',
    bgClass: 'bg-shift-sky',
    bg20Class: 'bg-shift-sky/20',
    tintClass:
      'bg-shift-tint-sky text-shift-tint-sky-fg ring-shift-tint-sky-fg/15 dark:bg-shift-deep-sky dark:text-shift-sky dark:ring-shift-sky/25',
    label: 'Sky',
  },
  {
    hex: '#6CA0EB',
    bgClass: 'bg-shift-indigo',
    bg20Class: 'bg-shift-indigo/20',
    tintClass:
      'bg-shift-tint-indigo text-shift-tint-indigo-fg ring-shift-tint-indigo-fg/15 dark:bg-shift-deep-indigo dark:text-shift-indigo dark:ring-shift-indigo/25',
    label: 'Indigo',
  },
  {
    hex: '#C48FD6',
    bgClass: 'bg-shift-violet',
    bg20Class: 'bg-shift-violet/20',
    tintClass:
      'bg-shift-tint-violet text-shift-tint-violet-fg ring-shift-tint-violet-fg/15 dark:bg-shift-deep-violet dark:text-shift-violet dark:ring-shift-violet/25',
    label: 'Violet',
  },
  {
    hex: '#E888AB',
    bgClass: 'bg-shift-rose',
    bg20Class: 'bg-shift-rose/20',
    tintClass:
      'bg-shift-tint-rose text-shift-tint-rose-fg ring-shift-tint-rose-fg/15 dark:bg-shift-deep-rose dark:text-shift-rose dark:ring-shift-rose/25',
    label: 'Rose',
  },
] as const;

/**
 * The neutral wash a finished shift wears instead of its shift-type colour.
 *
 * A rota is read forwards: colour is what draws the eye to the work still to
 * come, so spending it on shifts that have already been worked competes with
 * the part a manager can still act on. Past shifts stay fully legible. Same
 * layout, same times, but drop out of the colour system. This is a *token*
 * swap rather than a `grayscale`/`opacity` filter so the result is a
 * deliberate colour in both themes, not a washed-out approximation of one.
 */
export const PAST_SHIFT_TINT =
  'bg-surface-subtle text-content-muted ring-surface-border dark:bg-surface-subtle-dark dark:text-content-muted-dark dark:ring-surface-border-dark';

/** Solid-fill counterpart of PAST_SHIFT_TINT, for the chips that fill rather than wash. */
export const PAST_SHIFT_SOLID = 'bg-content-muted/45 dark:bg-content-muted-dark/35';

export function paletteTokenForColour(hex: string | null | undefined): string {
  const match = SHIFT_PALETTE.find((p) => p.hex.toLowerCase() === hex?.toLowerCase());
  return match?.bgClass ?? 'bg-secondary';
}

/** Complete `/20`-opacity class string for a swatch, keyed by hex. Tailwind can't purge a dynamically concatenated class. */
export function paletteToken20ForColour(hex: string | null | undefined): string {
  const match = SHIFT_PALETTE.find((p) => p.hex.toLowerCase() === hex?.toLowerCase());
  return match?.bg20Class ?? 'bg-secondary/20';
}

/**
 * Pale-wash background + saturated ink + hairline ring for a swatch. The rota
 * grid chip in docs/design/Rota-Builder.png. Written out in full (never
 * concatenated) so Tailwind's content scan can see every class.
 */
export function paletteTintForColour(hex: string | null | undefined): string {
  const match = SHIFT_PALETTE.find((p) => p.hex.toLowerCase() === hex?.toLowerCase());
  return (
    match?.tintClass ??
    'bg-surface-subtle text-content-muted ring-surface-border dark:bg-surface-subtle-dark dark:text-content-muted-dark dark:ring-surface-border-dark'
  );
}
