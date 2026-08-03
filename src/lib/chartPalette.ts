/**
 * The categorical series palette for charts.
 *
 * ## Why this is not the rota grid's palette
 *
 * The obvious move was to reuse `shift-*` from `tailwind.config.ts` — the
 * product already has eight named hues and they look right together. Run
 * against the six checks, that set **fails** as a chart palette: clay and
 * violet sit at ΔE 14.1 for *normal* colour vision (below the 15 floor, so
 * full-colour readers cannot reliably tell two adjacent series apart), and
 * every hue is under 3:1 against the card surface, because they are designed
 * as pale chip *washes* behind dark text, not as marks read on their own.
 *
 * So this is a separate, deeper set, checked rather than eyeballed. Both modes
 * pass lightness band, chroma floor, CVD separation, the normal-vision floor
 * and contrast.
 *
 * ## The order is fixed and must not be cycled
 *
 * Colour follows the *entity*, never its rank: a filter that drops a series
 * must not repaint the survivors. Callers index by a stable key, never by
 * position in the filtered array. A ninth series is not a generated hue — fold
 * it into "Other" or facet the chart.
 *
 * ## CVD separation is in the 6–8 band, so secondary encoding is required
 *
 * Amber↔green is the worst adjacent pair (ΔE 7.9 protan in light, 9.5 deutan
 * in dark). That is legal *only* alongside a non-colour channel, so every
 * chart built on this palette ships a legend, and `ChartLegend` pairs each
 * swatch with its label — identity is never carried by colour alone.
 */

export interface ChartSeriesColour {
  /** Light-mode step. */
  light: string;
  /** Dark-mode step — chosen against the dark surface, not an automatic flip. */
  dark: string;
}

/**
 * Validated 2026-08-03 with the dataviz validator:
 *
 * ```
 * light  #2563C9,#127D5E,#A76A0C,#8A46C4,#BE3B34  → ALL CHECKS PASS
 * dark   #4A8BE4,#1FA57C,#B08028,#9E6BD4,#DC6457  → ALL CHECKS PASS
 * ```
 *
 * Re-run both before changing any value here.
 */
export const CHART_SERIES: readonly ChartSeriesColour[] = [
  { light: '#2563C9', dark: '#4A8BE4' }, // blue
  { light: '#127D5E', dark: '#1FA57C' }, // green
  { light: '#A76A0C', dark: '#B08028' }, // amber
  { light: '#8A46C4', dark: '#9E6BD4' }, // violet
  { light: '#BE3B34', dark: '#DC6457' }, // red
] as const;

/**
 * The colour for a series, by its position in the *unfiltered* series list.
 *
 * Wraps rather than throwing past the fifth entry so a chart cannot crash on
 * unexpected data — but wrapping means two series share a hue, which is why
 * callers must fold beyond five into "Other" rather than rely on this.
 */
export function seriesColour(index: number, dark: boolean): string {
  const entry = CHART_SERIES[index % CHART_SERIES.length]!;
  return dark ? entry.dark : entry.light;
}
