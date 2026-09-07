import { describe, expect, it } from 'vitest';
import {
  buildOrganisationImportPreview,
  mapOrganisationColumns,
  previewOrganisationImport,
} from './organisationImport';

const HEADER = 'Name,Slug,Plan,Owner email,Price';

describe('mapOrganisationColumns', () => {
  it('accepts the names a real spreadsheet uses', () => {
    const columns = mapOrganisationColumns([
      'Organisation Name',
      'Handle',
      'Tier',
      'Contact Email',
      'Monthly price',
    ]);
    expect(columns.name).toBe(0);
    expect(columns.slug).toBe(1);
    expect(columns.plan).toBe(2);
    expect(columns.ownerEmail).toBe(3);
    expect(columns.pricePence).toBe(4);
  });

  it('reports a column it did not find as -1 rather than 0', () => {
    // A missing column reading as index 0 would silently import the name
    // column as the owner email for every row in the file.
    expect(mapOrganisationColumns(['Name']).ownerEmail).toBe(-1);
  });
});

describe('buildOrganisationImportPreview', () => {
  it('refuses a file with no name or owner column rather than guessing', () => {
    const preview = previewOrganisationImport('a,b\n1,2');
    expect(preview.unrecognised).toBe(true);
    expect(preview.missingColumns).toEqual(['name', 'owner email']);
  });

  it('reads a good row and derives a slug from the name when there is none', () => {
    const preview = previewOrganisationImport(
      `Name,Plan,Owner email\nAcme Facilities Ltd,business,ops@acme.example`,
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.problems).toEqual([]);
    expect(preview.rows[0]?.values.slug).toBe('acme-facilities-ltd');
    expect(preview.rows[0]?.values.plan).toBe('business');
  });

  it('keeps every row, valid or not', () => {
    // A preview that dropped the bad rows would create 2 of 3 and report
    // success, and the missing customer would be found by the customer.
    const preview = previewOrganisationImport(
      `${HEADER}\nGood Ltd,good-ltd,starter,a@x.example,\n,,starter,b@x.example,\nAlso Good,also-good,starter,c@x.example,`,
    );
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[1]?.problems).toContain('No organisation name');
  });

  it('catches a slug already taken by an existing organisation', () => {
    const preview = buildOrganisationImportPreview(
      [
        ['Name', 'Slug', 'Plan', 'Owner email'],
        ['Acme', 'acme', 'starter', 'a@x.example'],
      ],
      ['acme'],
    );
    expect(preview.rows[0]?.problems[0]).toContain('already taken');
  });

  it('catches a slug repeated inside the file', () => {
    const preview = previewOrganisationImport(
      `${HEADER}\nOne,dup,starter,a@x.example,\nTwo,dup,starter,b@x.example,`,
    );
    expect(preview.rows[0]?.problems).toEqual([]);
    expect(preview.rows[1]?.problems[0]).toContain('appears twice');
  });

  it('refuses a slug that the column would not accept', () => {
    const preview = previewOrganisationImport(
      `${HEADER}\nOne,Not A Slug!,starter,a@x.example,`,
    );
    expect(preview.rows[0]?.problems[0]).toContain('not a valid slug');
  });

  it('refuses a plan that is not a plan', () => {
    const preview = previewOrganisationImport(`${HEADER}\nOne,one,platinum,a@x.example,`);
    expect(preview.rows[0]?.problems.some((p) => p.includes('not a plan'))).toBe(true);
  });

  it('defaults an absent plan to starter rather than failing the row', () => {
    const preview = previewOrganisationImport(
      `Name,Slug,Owner email\nOne,one,a@x.example`,
    );
    expect(preview.rows[0]?.values.plan).toBe('starter');
    expect(preview.rows[0]?.problems).toEqual([]);
  });

  it('refuses a row with no owner email, because nobody could be invited', () => {
    const preview = previewOrganisationImport(`${HEADER}\nOne,one,starter,,`);
    expect(preview.rows[0]?.problems.some((p) => p.includes('No owner email'))).toBe(
      true,
    );
  });

  it('reads a price in pounds and stores it in pence', () => {
    const preview = previewOrganisationImport(
      `${HEADER}\nOne,one,business,a@x.example,£790.50`,
    );
    expect(preview.rows[0]?.values.pricePence).toBe(79050);
    expect(preview.rows[0]?.problems).toEqual([]);
  });

  it('refuses a price that is obviously the wrong unit', () => {
    const preview = previewOrganisationImport(
      `${HEADER}\nOne,one,business,a@x.example,79000000`,
    );
    expect(preview.rows[0]?.problems[0]).toContain('too high');
  });

  it('leaves the price null when the column is empty, so the plan price applies', () => {
    const preview = previewOrganisationImport(`${HEADER}\nOne,one,business,a@x.example,`);
    expect(preview.rows[0]?.values.pricePence).toBeNull();
  });

  it('numbers rows by their line in the spreadsheet', () => {
    const preview = previewOrganisationImport(
      `${HEADER}\nOne,one,starter,a@x.example,\nTwo,two,starter,b@x.example,`,
    );
    // Header is line 1, so the first data row is line 2 and matches what the
    // person sees in the file.
    expect(preview.rows.map((r) => r.line)).toEqual([2, 3]);
  });
});
