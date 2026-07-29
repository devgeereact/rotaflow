/**
 * The 8-colour shift-type palette (docs/DESIGN.md §2). Shift-type colours are
 * constrained to these swatches only — never a free hex input — so chips can
 * render via a token-class lookup and never touch a raw hex in a component.
 */
export const SHIFT_PALETTE = [
  { hex: '#E28273', bgClass: 'bg-shift-clay', bg20Class: 'bg-shift-clay/20', label: 'Clay' },
  { hex: '#C69A45', bgClass: 'bg-shift-amber', bg20Class: 'bg-shift-amber/20', label: 'Amber' },
  { hex: '#86AC6A', bgClass: 'bg-shift-moss', bg20Class: 'bg-shift-moss/20', label: 'Moss' },
  { hex: '#4FB39A', bgClass: 'bg-shift-teal', bg20Class: 'bg-shift-teal/20', label: 'Teal' },
  { hex: '#56AACD', bgClass: 'bg-shift-sky', bg20Class: 'bg-shift-sky/20', label: 'Sky' },
  { hex: '#6CA0EB', bgClass: 'bg-shift-indigo', bg20Class: 'bg-shift-indigo/20', label: 'Indigo' },
  { hex: '#C48FD6', bgClass: 'bg-shift-violet', bg20Class: 'bg-shift-violet/20', label: 'Violet' },
  { hex: '#E888AB', bgClass: 'bg-shift-rose', bg20Class: 'bg-shift-rose/20', label: 'Rose' },
] as const;

export function paletteTokenForColour(hex: string | null | undefined): string {
  const match = SHIFT_PALETTE.find((p) => p.hex.toLowerCase() === hex?.toLowerCase());
  return match?.bgClass ?? 'bg-secondary';
}

/** Complete `/20`-opacity class string for a swatch, keyed by hex — Tailwind can't purge a dynamically concatenated class. */
export function paletteToken20ForColour(hex: string | null | undefined): string {
  const match = SHIFT_PALETTE.find((p) => p.hex.toLowerCase() === hex?.toLowerCase());
  return match?.bg20Class ?? 'bg-secondary/20';
}
