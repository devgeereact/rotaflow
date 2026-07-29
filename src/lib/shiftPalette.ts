/**
 * The 8-colour shift-type palette (docs/DESIGN.md §2). Shift-type colours are
 * constrained to these swatches only — never a free hex input — so chips can
 * render via a token-class lookup and never touch a raw hex in a component.
 */
export const SHIFT_PALETTE = [
  { hex: '#E28273', bgClass: 'bg-shift-clay', label: 'Clay' },
  { hex: '#C69A45', bgClass: 'bg-shift-amber', label: 'Amber' },
  { hex: '#86AC6A', bgClass: 'bg-shift-moss', label: 'Moss' },
  { hex: '#4FB39A', bgClass: 'bg-shift-teal', label: 'Teal' },
  { hex: '#56AACD', bgClass: 'bg-shift-sky', label: 'Sky' },
  { hex: '#6CA0EB', bgClass: 'bg-shift-indigo', label: 'Indigo' },
  { hex: '#C48FD6', bgClass: 'bg-shift-violet', label: 'Violet' },
  { hex: '#E888AB', bgClass: 'bg-shift-rose', label: 'Rose' },
] as const;

export function paletteTokenForColour(hex: string | null | undefined): string {
  const match = SHIFT_PALETTE.find((p) => p.hex.toLowerCase() === hex?.toLowerCase());
  return match?.bgClass ?? 'bg-secondary';
}
