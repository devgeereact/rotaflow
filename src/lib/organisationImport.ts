import { parseCsv } from '@/lib/csvImport';
import { slugify } from '@/lib/slug';

/**
 * Reading a list of organisations out of a spreadsheet, for the platform
 * console's bulk import.
 *
 * ## Why this is a preview and not a loop
 *
 * The Import button was disabled with the title "Bulk import is not built",
 * and the creation contract it needed had existed since `0051`:
 * `admin_create_organisation_with_invite` creates the organisation, its
 * subscription and an owner invitation in one transaction, refuses to give
 * the administrator a membership, and is exempt from the self-serve
 * five-per-hour rate limit because it writes `created_by = null`.
 *
 * What is genuinely hard about a bulk import is not the loop. It is that a
 * partial failure has to be legible: fifty rows go in, three are refused, and
 * the person needs to know which three, why, and be able to retry only those
 * without creating the other forty-seven a second time. So every row is
 * previewed with its own verdict before anything is written, and every row
 * keeps its own outcome afterwards.
 *
 * Pure: no Supabase, no DOM. `src/lib` runs under Node in the unit suite,
 * where a Supabase import fails at module load.
 */

export type OrganisationPlan = 'starter' | 'professional' | 'business' | 'enterprise';

export const IMPORTABLE_PLANS: readonly OrganisationPlan[] = [
  'starter',
  'professional',
  'business',
  'enterprise',
];

export interface ImportedOrganisation {
  name: string;
  slug: string;
  plan: OrganisationPlan;
  ownerEmail: string;
  /** Pence. Null uses the plan's list price, which is the usual case. */
  pricePence: number | null;
}

export interface OrganisationImportRow {
  /** 1-based line in the file, header included, so it matches the spreadsheet. */
  line: number;
  values: ImportedOrganisation;
  /** Empty when the row can be created. */
  problems: string[];
}

export interface OrganisationImportPreview {
  rows: OrganisationImportRow[];
  /** True when nothing recognisable was found — usually the wrong delimiter. */
  unrecognised: boolean;
  /** Header names that were required and absent. */
  missingColumns: string[];
}

/** Deliberately loose. The strict check is the one the mail server does. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** `organisations.slug` is lower-case, alphanumeric and hyphens (0002). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const HEADERS: Record<keyof ImportedOrganisation, readonly string[]> = {
  name: ['name', 'organisation', 'organization', 'company', 'organisation name'],
  slug: ['slug', 'url', 'handle', 'short name'],
  plan: ['plan', 'tier', 'package'],
  ownerEmail: ['owner email', 'owner', 'email', 'contact email', 'owner_email'],
  pricePence: ['price', 'price pence', 'monthly price', 'negotiated price'],
};

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');
}

export function mapOrganisationColumns(
  header: readonly string[],
): Record<keyof ImportedOrganisation, number> {
  const normalised = header.map(normaliseHeader);
  const find = (names: readonly string[]): number =>
    normalised.findIndex((cell) => names.includes(cell));
  return {
    name: find(HEADERS.name),
    slug: find(HEADERS.slug),
    plan: find(HEADERS.plan),
    ownerEmail: find(HEADERS.ownerEmail),
    pricePence: find(HEADERS.pricePence),
  };
}

/**
 * Turn a parsed file into rows ready to create, each carrying its problems.
 *
 * Every row is returned, valid or not. A preview that silently dropped the
 * refused ones would create 47 of 50 organisations and report success, and
 * the three missing customers would be discovered by the customers.
 *
 * `existingSlugs` is what makes the second run of the same file safe — which
 * is a thing people do when the first appeared not to work. It has to come
 * from the database rather than from the file, because a slug collides with
 * a tenant created last year just as easily as with one two rows above.
 */
export function buildOrganisationImportPreview(
  parsed: readonly (readonly string[])[],
  existingSlugs: readonly string[] = [],
): OrganisationImportPreview {
  const rows = parsed.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (rows.length === 0) return { rows: [], unrecognised: true, missingColumns: [] };

  const header = rows[0] ?? [];
  const columns = mapOrganisationColumns(header);

  // Name and owner email are the two a creation cannot proceed without. A
  // slug is derived from the name when absent, and a plan falls back to
  // starter, because both are recoverable and neither is a guess about who
  // the customer is.
  const missingColumns: string[] = [];
  if (columns.name === -1) missingColumns.push('name');
  if (columns.ownerEmail === -1) missingColumns.push('owner email');
  if (missingColumns.length > 0) {
    return { rows: [], unrecognised: true, missingColumns };
  }

  const known = new Set(existingSlugs.map((s) => s.toLowerCase()));
  const seenSlugs = new Set<string>();
  const seenEmails = new Set<string>();
  const out: OrganisationImportRow[] = [];

  rows.slice(1).forEach((cells, index) => {
    const cell = (column: number): string =>
      column === -1 ? '' : (cells[column] ?? '').trim();

    const name = cell(columns.name);
    const rawSlug = cell(columns.slug);
    const slug = rawSlug === '' ? slugify(name) : rawSlug.toLowerCase();
    const rawPlan = cell(columns.plan).toLowerCase();
    const plan = (rawPlan === '' ? 'starter' : rawPlan) as OrganisationPlan;
    const ownerEmail = cell(columns.ownerEmail).toLowerCase();
    const rawPrice = cell(columns.pricePence);

    const problems: string[] = [];

    if (name === '') problems.push('No organisation name');

    if (slug === '') {
      problems.push('No slug, and the name produced none');
    } else if (!SLUG.test(slug)) {
      problems.push(`"${slug}" is not a valid slug — lower case, digits and hyphens`);
    } else if (known.has(slug)) {
      problems.push(`"${slug}" is already taken by an existing organisation`);
    } else if (seenSlugs.has(slug)) {
      problems.push(`"${slug}" appears twice in this file`);
    }
    if (slug !== '') seenSlugs.add(slug);

    if (!IMPORTABLE_PLANS.includes(plan)) {
      problems.push(`"${rawPlan}" is not a plan — use ${IMPORTABLE_PLANS.join(', ')}`);
    }

    if (ownerEmail === '') {
      problems.push('No owner email, so nobody could be invited');
    } else if (!EMAIL.test(ownerEmail)) {
      problems.push(`"${ownerEmail}" is not an email address`);
    } else if (seenEmails.has(ownerEmail)) {
      // Not fatal in the database — one person can own two organisations —
      // but it is nearly always a copy-paste error in a file, and creating
      // both silently is the expensive way to find out.
      problems.push('This owner email appears twice in this file');
    }
    if (ownerEmail !== '') seenEmails.add(ownerEmail);

    let pricePence: number | null = null;
    if (rawPrice !== '') {
      // Pounds, because that is what somebody types into a spreadsheet. The
      // column is named "price" and a person writing 79 means £79, not 79p.
      const pounds = Number(rawPrice.replace(/[£,]/g, ''));
      if (!Number.isFinite(pounds) || pounds < 0) {
        problems.push(`"${rawPrice}" is not a price`);
      } else if (pounds > 1_000_000) {
        problems.push(`"${rawPrice}" seems too high — the column is in pounds`);
      } else {
        pricePence = Math.round(pounds * 100);
      }
    }

    out.push({
      line: index + 2,
      values: { name, slug, plan, ownerEmail, pricePence },
      problems,
    });
  });

  return { rows: out, unrecognised: false, missingColumns: [] };
}

/** Parse and preview in one step, for a caller holding file text. */
export function previewOrganisationImport(
  text: string,
  existingSlugs: readonly string[] = [],
): OrganisationImportPreview {
  return buildOrganisationImportPreview(parseCsv(text), existingSlugs);
}

/** The header row of the template offered on the import screen. */
export const ORGANISATION_IMPORT_TEMPLATE =
  'Name,Slug,Plan,Owner email,Price\nAcme Facilities Ltd,acme-facilities,business,ops@acme.example,\n';
