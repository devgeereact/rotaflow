import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  documentFileProblem,
  documentObjectPath,
  safeFileName,
} from './documentFiles';

const ORG = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

describe('documentFileProblem', () => {
  it('accepts a PDF under the limit', () => {
    expect(
      documentFileProblem({ name: 'a.pdf', size: 1000, type: 'application/pdf' }),
    ).toBeNull();
  });

  it('refuses an empty file, an oversized file and an unsupported type', () => {
    expect(
      documentFileProblem({ name: 'a.pdf', size: 0, type: 'application/pdf' }),
    ).toMatch(/empty/);
    expect(
      documentFileProblem({
        name: 'a.pdf',
        size: MAX_DOCUMENT_BYTES + 1,
        type: 'application/pdf',
      }),
    ).toMatch(/10 MB/);
    expect(
      documentFileProblem({ name: 'a.exe', size: 10, type: 'application/x-msdownload' }),
    ).toMatch(/PDF/);
  });
});

describe('safeFileName', () => {
  it('keeps an ordinary name and lower-cases the extension', () => {
    expect(safeFileName('Passport scan.PDF')).toBe('Passport-scan.pdf');
  });

  it('removes slashes and traversal so the name stays one path segment', () => {
    const name = safeFileName('../../other-org/secret.pdf');
    expect(name).not.toContain('/');
    expect(name.startsWith('.')).toBe(false);
  });

  it('falls back to a stem when nothing usable is left', () => {
    expect(safeFileName('???.png')).toBe('document.png');
    expect(safeFileName('')).toBe('document');
  });

  it('limits the length', () => {
    expect(safeFileName(`${'x'.repeat(200)}.pdf`).length).toBeLessThanOrEqual(64);
  });
});

describe('documentObjectPath', () => {
  it('puts the file in its organisation and person folder', () => {
    expect(documentObjectPath(ORG, PERSON, 'abc', 'DBS certificate.pdf')).toBe(
      `${ORG}/${PERSON}/abc-DBS-certificate.pdf`,
    );
  });

  it('is always exactly three segments, whatever the file is called', () => {
    expect(documentObjectPath(ORG, PERSON, 'abc', 'a/b/c.pdf').split('/')).toHaveLength(
      3,
    );
  });
});
