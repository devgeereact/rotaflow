/**
 * The API stores every timestamp in UTC (the database session runs at +00:00), and most routes answer MariaDB's
 * `YYYY-MM-DD HH:MM:SS`. A browser reads that form as LOCAL time, which is an hour out for half the year in the
 * UK. This turns every such string in a response into ISO 8601 with `Z`, so `new Date()` reads it as UTC. Plain
 * dates (`YYYY-MM-DD`) and times of day (`HH:MM:SS`) are left alone: they are wall-clock values, not instants.
 */
const SQL_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)$/;

export function isoFromSql(value: string): string {
  const m = SQL_DATETIME.exec(value);
  return m ? `${m[1]}T${m[2]}Z` : value;
}

/** Returns a copy with every SQL datetime string converted; other values are untouched. */
export function normaliseApiDates<T>(value: T): T {
  if (typeof value === 'string') return isoFromSql(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => normaliseApiDates(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normaliseApiDates(v);
    }
    return out as T;
  }
  return value;
}
