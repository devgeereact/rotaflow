/**
 * Reading a staff list out of a spreadsheet (CAP-084).
 *
 * A new customer with sixty staff had to type sixty people into a modal, one
 * at a time, before the product could do anything for them. That is the gap
 * between a trial that converts and one that is abandoned on the first
 * evening, and every one of those sixty people already exists in a
 * spreadsheet somewhere.
 *
 * ## Why this parses CSV by hand
 *
 * No dependency. The format looks trivial and is not — quoted fields
 * containing commas and newlines are exactly what a real export produces from
 * an address or a job title — but the whole grammar is one page, it is stable,
 * and it is pure logic that can be tested properly. Pulling in a parser to
 * read a header row and some names is a supply-chain decision made for
 * convenience.
 *
 * Everything here is pure: no Supabase, no DOM. `src/lib` is unit-tested and
 * runs under Node, where a Supabase import would fail at module load.
 */

/**
 * RFC 4180, with the concessions real files need.
 *
 * - a UTF-8 BOM, which Excel writes and which otherwise becomes part of the
 *   first header name, so the first column silently never matches;
 * - CRLF or LF, mixed;
 * - `""` inside a quoted field, meaning one quote character;
 * - a trailing newline, which is not an empty row.
 *
 * Semicolon-delimited files — the default in several European locales — are
 * NOT handled, deliberately. Guessing the delimiter gets it wrong on a file
 * whose first row happens to contain a semicolon, and being wrong quietly is
 * worse here than refusing: the caller reports "no recognised columns" and
 * the person re-exports.
 */
export function parseCsv(input: string): string[][] {
  // \uFEFF, written by name rather than pasted: a literal BOM in source is
  // invisible in every editor and reads as a stray character to a linter.
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      // Lone CR is a line ending too — old Mac exports still exist.
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // A file ending in a newline has no final row; one ending mid-field does.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/** What a column in the file means. */
export type StaffColumn =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'jobTitle'
  | 'department'
  | 'phone'
  | 'contractType'
  | 'weeklyHours'
  | 'payrollId'
  | 'startDate';

/**
 * Header names accepted for each column.
 *
 * Generous on purpose. The file comes from the customer's old system, and
 * "Surname", "Last Name" and "family_name" are the same thing. Matching is
 * case-insensitive and ignores spaces, underscores and hyphens, so
 * `Weekly Hours`, `weekly_hours` and `WeeklyHours` all land.
 */
const HEADERS: Record<StaffColumn, readonly string[]> = {
  firstName: ['firstname', 'first', 'forename', 'givenname'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  email: ['email', 'emailaddress', 'workemail'],
  jobTitle: ['jobtitle', 'title', 'role', 'position'],
  department: ['department', 'dept', 'team'],
  phone: ['phone', 'mobile', 'telephone', 'contactnumber'],
  contractType: ['contracttype', 'contract', 'employmenttype'],
  weeklyHours: ['weeklyhours', 'hours', 'contractedhours'],
  payrollId: ['payrollid', 'payrollnumber', 'employeeid', 'employeenumber'],
  startDate: ['startdate', 'started', 'joined', 'joindate'],
};

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_\-.]/g, '');
}

/** Which file column holds each field, or -1. */
export function mapColumns(header: readonly string[]): Record<StaffColumn, number> {
  const normalised = header.map(normaliseHeader);
  const found = {} as Record<StaffColumn, number>;

  for (const key of Object.keys(HEADERS) as StaffColumn[]) {
    found[key] = normalised.findIndex((h) => HEADERS[key].includes(h));
  }
  return found;
}

export interface ImportedStaff {
  firstName: string;
  lastName: string;
  email: string | null;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  contractType: string | null;
  weeklyHours: number | null;
  payrollId: string | null;
  startDate: string | null;
}

export interface ImportRow {
  /** 1-based line in the file, header included, so it matches the spreadsheet. */
  line: number;
  values: ImportedStaff;
  /** Empty when the row can be imported. */
  problems: string[];
}

export interface ImportPreview {
  rows: ImportRow[];
  /** Named columns the file did not have. Empty is fine; missing both names is not. */
  missingColumns: StaffColumn[];
  /** True when nothing recognisable was found — usually the wrong delimiter. */
  unrecognised: boolean;
}

/** Deliberately loose. The strict check is the one the mail server does. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn a parsed file into rows ready to import, each carrying its own
 * problems.
 *
 * Every row is returned, valid or not. A preview that silently dropped the
 * bad ones would import 57 of 60 people and say "done", and nobody would
 * find the missing three until a shift went uncovered.
 *
 * `existingEmails` catches the second import of the same file, which is a
 * thing people do when the first one appears not to have worked.
 */
export function buildImportPreview(
  parsed: readonly (readonly string[])[],
  existingEmails: readonly string[] = [],
): ImportPreview {
  const rows = parsed.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (rows.length === 0) return { rows: [], missingColumns: [], unrecognised: true };

  const header = rows[0] ?? [];
  const columns = mapColumns(header);

  const missingColumns = (Object.keys(HEADERS) as StaffColumn[]).filter(
    (key) => columns[key] === -1,
  );

  // Without a name there is nothing to create, so that is the one fatal
  // shape. Everything else is optional and can be filled in afterwards.
  if (columns.firstName === -1 || columns.lastName === -1) {
    return { rows: [], missingColumns, unrecognised: true };
  }

  const known = new Set(existingEmails.map((e) => e.toLowerCase()));
  const seen = new Set<string>();
  const out: ImportRow[] = [];

  rows.slice(1).forEach((cells, index) => {
    const cell = (column: number): string =>
      column === -1 ? '' : (cells[column] ?? '').trim();
    const orNull = (value: string): string | null => (value === '' ? null : value);

    const email = cell(columns.email).toLowerCase();
    const hours = cell(columns.weeklyHours);
    const startDate = cell(columns.startDate);
    const problems: string[] = [];

    const values: ImportedStaff = {
      firstName: cell(columns.firstName),
      lastName: cell(columns.lastName),
      email: orNull(email),
      jobTitle: orNull(cell(columns.jobTitle)),
      department: orNull(cell(columns.department)),
      phone: orNull(cell(columns.phone)),
      contractType: orNull(cell(columns.contractType)),
      weeklyHours: hours === '' ? null : Number(hours),
      payrollId: orNull(cell(columns.payrollId)),
      startDate: orNull(startDate),
    };

    if (values.firstName === '') problems.push('No first name');
    if (values.lastName === '') problems.push('No last name');

    if (email !== '' && !EMAIL.test(email)) {
      problems.push(`"${email}" is not an email address`);
    } else if (email !== '' && known.has(email)) {
      problems.push('Somebody with this email is already on the team');
    } else if (email !== '' && seen.has(email)) {
      problems.push('This email appears twice in the file');
    }
    if (email !== '') seen.add(email);

    if (
      hours !== '' &&
      (Number.isNaN(values.weeklyHours) || (values.weeklyHours ?? 0) < 0)
    ) {
      problems.push(`"${hours}" is not a number of hours`);
    } else if ((values.weeklyHours ?? 0) > 168) {
      // There are 168 hours in a week. A 400 in this column is a typo or a
      // monthly figure, and importing it silently poisons every overtime and
      // utilisation number the product reports.
      problems.push(`${hours} hours a week is more than a week`);
    }

    if (startDate !== '' && !ISO_DATE.test(startDate)) {
      // Not guessed. `03/04/2026` is March in one country and April in
      // another, and a start date silently six months out changes holiday
      // entitlement. The person is asked to use YYYY-MM-DD.
      problems.push(`Dates must be YYYY-MM-DD — "${startDate}" is ambiguous`);
    }

    out.push({ line: index + 2, values, problems });
  });

  return { rows: out, missingColumns, unrecognised: false };
}

/** The header row of the template offered on the import screen. */
export const IMPORT_TEMPLATE_HEADER =
  'First name,Last name,Email,Job title,Department,Phone,Contract type,Weekly hours,Payroll ID,Start date';
