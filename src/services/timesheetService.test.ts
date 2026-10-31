import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiFile } from '@/lib/apiClient';

/**
 * The payroll export through the marking route (owner decision, 31 Oct 2026): the button calls
 * `POST timesheets/export`, downloads what the server wrote, and tells the person how many
 * periods were marked. An exported period still counts as signed off on the page.
 */
const postFile = vi.fn<(path: string, body?: unknown) => Promise<ApiFile>>();
const getFile = vi.fn<() => Promise<ApiFile>>();
const downloadBlob = vi.fn();

vi.mock('@/lib/api', () => ({
  api: { postFile: (p: string, b?: unknown) => postFile(p, b), getFile: () => getFile() },
  orgPath: (o: string, rest: string) => `/orgs/${o}${rest}`,
  activeOrgPath: (rest: string) => `/orgs/active${rest}`,
  seg: (s: string) => s,
}));
vi.mock('@/lib/csv', () => ({
  downloadBlob: (name: string, body: Blob) => {
    downloadBlob(name, body);
  },
}));

const { exportPayrollCsv, isSignedOff, payrollExportMessage } = await import(
  './timesheetService'
);

const file = (headers: Record<string, string>, filename: string | null): ApiFile => ({
  body: new Blob(['x']),
  filename,
  header: (n: string) => headers[n] ?? null,
});

afterEach(() => vi.clearAllMocks());

describe('exportPayrollCsv', () => {
  it('POSTs the range to the marking route, downloads the server file and reads the counts', async () => {
    postFile.mockResolvedValue(
      file(
        { 'X-RotaFlow-Marked-Exported': '3', 'X-RotaFlow-Already-Exported': '1' },
        'rotaflow-timesheets-acme-2026-10-19-2026-10-25.csv',
      ),
    );
    const r = await exportPayrollCsv('org-1', '2026-10-19', '2026-10-25');
    expect(postFile).toHaveBeenCalledWith('/orgs/org-1/timesheets/export', {
      period_start: '2026-10-19',
      period_end: '2026-10-25',
    });
    expect(getFile).not.toHaveBeenCalled();
    expect(downloadBlob.mock.calls[0]?.[0]).toBe(
      'rotaflow-timesheets-acme-2026-10-19-2026-10-25.csv',
    );
    expect(r).toEqual({ marked: 3, alreadyExported: 1 });
  });

  it('names the file itself when the server sends no name, and reads missing counts as 0', async () => {
    postFile.mockResolvedValue(file({}, null));
    const r = await exportPayrollCsv('org-1', '2026-10-19', '2026-10-25');
    expect(downloadBlob.mock.calls[0]?.[0]).toBe(
      'rotaflow-timesheets-organisation-2026-10-19-2026-10-25.csv',
    );
    expect(r).toEqual({ marked: 0, alreadyExported: 0 });
  });

  it('does not download when the server refuses', async () => {
    postFile.mockRejectedValue(new Error('forbidden'));
    await expect(exportPayrollCsv('org-1', '2026-10-19', '2026-10-25')).rejects.toThrow();
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});

describe('payrollExportMessage', () => {
  it('says how many periods were marked, and any exported before', () => {
    expect(payrollExportMessage({ marked: 1, alreadyExported: 0 })).toBe(
      'Payroll CSV downloaded. 1 period marked as exported.',
    );
    expect(payrollExportMessage({ marked: 4, alreadyExported: 2 })).toBe(
      'Payroll CSV downloaded. 4 periods marked as exported. 2 periods in the file had been exported before.',
    );
    expect(payrollExportMessage({ marked: 0, alreadyExported: 1 })).toBe(
      'Payroll CSV downloaded. No new periods were marked as exported. 1 period in the file had been exported before.',
    );
  });
});

describe('isSignedOff', () => {
  it('counts approved and exported periods as signed off, nothing else', () => {
    expect(isSignedOff('approved')).toBe(true);
    expect(isSignedOff('exported')).toBe(true);
    expect(isSignedOff('submitted')).toBe(false);
    expect(isSignedOff('open')).toBe(false);
  });
});
