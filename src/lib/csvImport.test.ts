import { describe, expect, it } from 'vitest';
import { buildImportPreview, mapColumns, parseCsv } from '@/lib/csvImport';

/**
 * Reading a staff list out of a spreadsheet (CAP-084).
 *
 * The parsing is hand-written, so it is tested against what real exports
 * actually contain rather than against the tidy case.
 */

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    // The case that breaks a split(',') implementation, and the one every
    // address and job title produces.
    expect(parseCsv('name,title\n"Ada","Nurse, Band 6"')).toEqual([
      ['name', 'title'],
      ['Ada', 'Nurse, Band 6'],
    ]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(parseCsv('a\n"one\ntwo"')).toEqual([['a'], ['one\ntwo']]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('a\n"she said ""no"""')).toEqual([['a'], ['she said "no"']]);
  });

  it('handles CRLF, which is what Excel writes', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips the BOM Excel puts in front of the first header', () => {
    // Without this the first column is called "\uFEFFfirst name" and silently
    // never matches, so every row imports with no first name.
    const rows = parseCsv('\uFEFFfirst name,last name\nAda,Lovelace');
    expect(rows[0]?.[0]).toBe('first name');
  });

  it('does not invent a trailing empty row', () => {
    expect(parseCsv('a\n1\n')).toHaveLength(2);
  });
});

describe('mapColumns', () => {
  it('accepts the names another system would have used', () => {
    const columns = mapColumns(['Surname', 'Forename', 'Work Email', 'contracted_hours']);
    expect(columns.lastName).toBe(0);
    expect(columns.firstName).toBe(1);
    expect(columns.email).toBe(2);
    expect(columns.weeklyHours).toBe(3);
  });

  it('reports a column that is not there as -1', () => {
    expect(mapColumns(['First name']).payrollId).toBe(-1);
  });
});

describe('buildImportPreview', () => {
  const file = (body: string): string[][] => parseCsv(body);

  it('reads a good file', () => {
    const preview = buildImportPreview(
      file('First name,Last name,Email\nAda,Lovelace,ada@example.test'),
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.problems).toEqual([]);
    expect(preview.rows[0]?.values.email).toBe('ada@example.test');
  });

  it('refuses a file with no name columns rather than guessing', () => {
    const preview = buildImportPreview(file('a;b;c\n1;2;3'));
    expect(preview.unrecognised).toBe(true);
  });

  it('keeps a bad row instead of dropping it', () => {
    // The whole point. A preview that quietly dropped the bad rows would
    // import 57 of 60 people, say "done", and nobody would find the other
    // three until a shift went uncovered.
    const preview = buildImportPreview(
      file('First name,Last name\nAda,Lovelace\n,Babbage'),
    );
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[1]?.problems).toContain('No first name');
  });

  it('numbers rows the way the spreadsheet does', () => {
    const preview = buildImportPreview(file('First name,Last name\nAda,Lovelace'));
    expect(preview.rows[0]?.line).toBe(2);
  });

  it('catches an email that appears twice in the same file', () => {
    const preview = buildImportPreview(
      file(
        'First name,Last name,Email\nAda,Lovelace,a@example.test\nGrace,Hopper,A@Example.test',
      ),
    );
    expect(preview.rows[1]?.problems).toContain('This email appears twice in the file');
  });

  it('catches somebody who is already on the team', () => {
    // Importing the same file twice is what people do when the first attempt
    // appears not to have worked.
    const preview = buildImportPreview(
      file('First name,Last name,Email\nAda,Lovelace,ada@example.test'),
      ['ADA@example.test'],
    );
    expect(preview.rows[0]?.problems).toContain(
      'Somebody with this email is already on the team',
    );
  });

  it('rejects more hours than a week contains', () => {
    // A 400 in this column is a monthly figure or a typo, and importing it
    // poisons every overtime and utilisation number the product reports.
    const preview = buildImportPreview(
      file('First name,Last name,Weekly hours\nAda,Lovelace,400'),
    );
    expect(preview.rows[0]?.problems[0]).toContain('more than a week');
  });

  it('refuses an ambiguous date rather than guessing the order', () => {
    // 03/04/2026 is March in one country and April in another, and a start
    // date six months out changes holiday entitlement.
    const preview = buildImportPreview(
      file('First name,Last name,Start date\nAda,Lovelace,03/04/2026'),
    );
    expect(preview.rows[0]?.problems[0]).toContain('YYYY-MM-DD');
  });

  it('accepts a file that only has the two names', () => {
    const preview = buildImportPreview(file('First name,Last name\nAda,Lovelace'));
    expect(preview.rows[0]?.problems).toEqual([]);
    expect(preview.missingColumns).toContain('email');
  });

  it('ignores blank lines', () => {
    const preview = buildImportPreview(file('First name,Last name\nAda,Lovelace\n\n'));
    expect(preview.rows).toHaveLength(1);
  });
});
