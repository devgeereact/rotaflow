import { describe, expect, it } from 'vitest';
import { buildCsv } from '@/lib/csv';

interface Row {
  name: string;
  variance: number;
}

const COLUMNS = [
  { label: 'Name', value: (r: Row) => r.name },
  { label: 'Variance', value: (r: Row) => r.variance },
];

describe('CSV formula injection', () => {
  /**
   * The data in these files is typed by tenant users — a job title, a note, a
   * person's name — and the file leaves the product to be opened in a
   * spreadsheet. A cell beginning `=`, `+`, `@`, a tab or a carriage return is
   * executed on open.
   */
  it('neutralises a leading formula character', () => {
    const csv = buildCsv([{ name: "=cmd|'/C calc'!A0", variance: 0 }], COLUMNS);
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/(^|,)=cmd/m);
  });

  it('covers +, @ and the control characters too', () => {
    for (const payload of ['+1+1', '@SUM(A1)', '\tstart', '\rstart']) {
      const csv = buildCsv([{ name: payload, variance: 0 }], COLUMNS);
      expect(csv).toContain(`'${payload}`.slice(0, 3));
    }
  });

  it('leaves a negative NUMBER alone', () => {
    // `-` is a live prefix (`-2+3+cmd|…`), but quoting every negative into
    // text would make a variance column unusable for the arithmetic it exists
    // for. Anything that parses as a plain number is left exactly as it is.
    const csv = buildCsv([{ name: 'Marcus Webb', variance: -90 }], COLUMNS);
    expect(csv).toContain('-90');
    expect(csv).not.toContain("'-90");
  });

  it('still neutralises a negative that is not a number', () => {
    const csv = buildCsv([{ name: '-2+3+cmd|x', variance: 0 }], COLUMNS);
    expect(csv).toContain("'-2+3");
  });

  it('leaves ordinary text untouched', () => {
    const csv = buildCsv([{ name: 'Senior Carer', variance: 5 }], COLUMNS);
    expect(csv).toContain('Senior Carer');
    expect(csv).not.toContain("'Senior");
  });
});

describe('quoting', () => {
  it('quotes a field containing a comma, a quote or a newline', () => {
    const csv = buildCsv([{ name: 'Smith, John "JJ"\nLine two', variance: 0 }], COLUMNS);
    expect(csv).toContain('"Smith, John ""JJ""\nLine two"');
  });
});

describe('scope notes', () => {
  it('writes the notes above the header, each commented', () => {
    const csv = buildCsv([{ name: 'A', variance: 1 }], COLUMNS, {
      notes: ['Organisation: Sunnyvale', 'Reporting timezone: Europe/London'],
    });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('# Organisation: Sunnyvale');
    expect(lines[1]).toBe('# Reporting timezone: Europe/London');
    expect(lines[2]).toBe('Name,Variance');
  });

  it('omits the preamble entirely when there are no notes', () => {
    expect(buildCsv([{ name: 'A', variance: 1 }], COLUMNS).split('\r\n')[0]).toBe(
      'Name,Variance',
    );
  });
});
