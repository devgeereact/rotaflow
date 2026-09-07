/**
 * Minimal RFC 4180 CSV output, plus a generic browser-download trigger
 * reused for both CSV reports and GDPR JSON exports. Same
 * Blob → object URL → temporary `<a download>` mechanics as `downloadIcs`
 * (`src/lib/ics.ts`). This is the analogous helper for tabular/structured
 * data instead of iCalendar.
 */

export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
}

/**
 * Characters a spreadsheet treats as the start of a formula rather than as
 * text. A cell beginning with one of these is executed on open, so a staff
 * "job title" reading `=HYPERLINK("http://evil","click")` — or the classic
 * `=cmd|'/C calc'!A0` — runs against whoever opens the export. The data comes
 * from tenant users and leaves the product as a file, which is exactly the
 * shape CSV injection needs.
 */
const FORMULA_PREFIXES = ['=', '+', '@', '\t', '\r'];

/** A value a spreadsheet can only read as a number, so it is never a formula. */
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * Neutralise a leading formula character by prefixing an apostrophe, which
 * every major spreadsheet reads as "the rest of this cell is text".
 *
 * `-` is in scope too (`-2+3+cmd|…` is a live payload) but a bare negative
 * number is not: variance columns are full of them, and quoting `-90` into
 * text would make every export unusable for the arithmetic it exists for. So
 * anything that parses as a plain number is left exactly as it is.
 */
function neutraliseFormula(value: string): string {
  if (value === '' || PLAIN_NUMBER.test(value)) return value;
  const first = value[0]!;
  if (FORMULA_PREFIXES.includes(first) || first === '-') return `'${value}`;
  return value;
}

/** Quote a field whenever it contains a comma, quote, or newline. */
function escapeCsvField(value: string): string {
  const safe = neutraliseFormula(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface CsvOptions {
  /**
   * Lines written above the header, each one prefixed with `#`.
   *
   * An export is read away from the screen that produced it, so it has to
   * carry its own scope: which organisation, which sites, which dates and
   * which timezone the times in it are stated in. Without that, a column of
   * `06:00`s is unreadable — the reader cannot tell whether it is site-local
   * or the exporter's browser.
   */
  notes?: readonly string[];
}

export function buildCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  options: CsvOptions = {},
): string {
  const preamble = (options.notes ?? []).map((note) => `${escapeCsvField(`# ${note}`)}`);
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(String(c.value(row) ?? ''))).join(','),
  );
  return [...preamble, header, ...lines].join('\r\n') + '\r\n';
}

/** Trigger a browser download of arbitrary text content. */
export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
  options: CsvOptions = {},
): void {
  downloadFile(
    filename.endsWith('.csv') ? filename : `${filename}.csv`,
    buildCsv(rows, columns, options),
    'text/csv;charset=utf-8',
  );
}

export function downloadJson(filename: string, data: unknown): void {
  downloadFile(
    filename.endsWith('.json') ? filename : `${filename}.json`,
    JSON.stringify(data, null, 2),
    'application/json;charset=utf-8',
  );
}
