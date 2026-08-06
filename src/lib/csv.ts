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

/** Quote a field whenever it contains a comma, quote, or newline. */
function escapeCsvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(String(c.value(row) ?? ''))).join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
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
): void {
  downloadFile(
    filename.endsWith('.csv') ? filename : `${filename}.csv`,
    buildCsv(rows, columns),
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
