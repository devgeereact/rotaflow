import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { FileUp, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Modal } from '@/components/ui/Modal';
import {
  buildImportPreview,
  IMPORT_TEMPLATE_HEADER,
  parseCsv,
  type ImportPreview,
} from '@/lib/csvImport';
import type { Department } from '@/types';

interface ImportStaffModalProps {
  open: boolean;
  onClose: () => void;
  /** Emails already on the team, so a second run of the same file is caught. */
  existingEmails: readonly string[];
  departments: readonly Department[];
  /** Resolves with how many landed. Throws to show the error in place. */
  onImport: (preview: ImportPreview) => Promise<number>;
}

/**
 * Import a staff list from a spreadsheet (CAP-084).
 *
 * ## Preview, then import. Never straight in
 *
 * The file comes out of somebody else's system and is wrong in ways nobody
 * can predict — a merged header row, hours recorded monthly, a date in the
 * American order. So the file is read in the browser and shown back before
 * anything is written, with each row's problems beside it.
 *
 * Rows with problems are **shown and skipped**, not silently dropped. An
 * import that quietly took 57 of 60 people and reported success is how a
 * shift ends up uncovered three weeks later.
 *
 * ## No auth accounts, no emails
 *
 * This creates staff records. It does not create logins and does not send
 * anything: sixty invitations firing off the back of a file somebody was
 * still checking is not recoverable. The email is stored so the existing
 * invite flow can match them later, and the modal says so.
 */
export function ImportStaffModal({
  open,
  onClose,
  existingEmails,
  departments,
  onImport,
}: ImportStaffModalProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      if (!file) return;
      setFailure(null);
      setFileName(file.name);
      const text = await file.text();
      setPreview(buildImportPreview(parseCsv(text), existingEmails));
    },
    [existingEmails],
  );

  const reset = useCallback((): void => {
    setPreview(null);
    setFileName(null);
    setFailure(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const importable = preview?.rows.filter((r) => r.problems.length === 0) ?? [];
  const rejected = preview?.rows.filter((r) => r.problems.length > 0) ?? [];

  const handleImport = useCallback(async (): Promise<void> => {
    if (!preview) return;
    setImporting(true);
    setFailure(null);
    try {
      await onImport(preview);
      reset();
      onClose();
    } catch (err) {
      setFailure(
        err && typeof err === 'object' && 'message' in err
          ? String(err.message)
          : 'The import did not complete.',
      );
    } finally {
      setImporting(false);
    }
  }, [preview, onImport, onClose, reset]);

  // Unknown department names are imported as people with no department
  // rather than refused. A department is a filter, not an identity, and
  // refusing sixty people over a spelling would be the wrong trade.
  const knownDepartments = new Set(departments.map((d) => d.name.toLowerCase()));
  const unknownDepartments = [
    ...new Set(
      importable
        .map((r) => r.values.department)
        .filter(
          (d): d is string => Boolean(d) && !knownDepartments.has(d!.toLowerCase()),
        ),
    ),
  ];

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import staff from a spreadsheet"
    >
      <div className="space-y-5">
        {!preview && (
          <>
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              A CSV with a header row. <strong>First name</strong> and{' '}
              <strong>Last name</strong> are the only columns that must be there;
              everything else is optional and can be filled in later.
            </p>
            <p className="rounded-xl bg-surface-muted p-3 font-mono text-xs text-content dark:bg-surface-muted-dark dark:text-content-dark">
              {IMPORT_TEMPLATE_HEADER}
            </p>
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Dates must be written <strong>YYYY-MM-DD</strong>. Nothing is emailed and no
              logins are created — this adds the people, and you invite them when you are
              ready.
            </p>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-surface-border px-4 py-8 text-sm font-medium text-content dark:border-surface-border-dark dark:text-content-dark">
              <FileUp size={18} aria-hidden="true" />
              Choose a CSV file
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => void handleFile(e)}
              />
            </label>
          </>
        )}

        {preview?.unrecognised && (
          <Callout tone="warning" title="No first and last name columns were found">
            <p>
              {fileName} does not have columns this can read. It may be saved with
              semicolons instead of commas, which some spreadsheet programs do by default
              — re-export it as a comma-separated CSV.
            </p>
          </Callout>
        )}

        {preview && !preview.unrecognised && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="success">{importable.length} ready</Badge>
              {rejected.length > 0 && (
                <Badge tone="warning">{rejected.length} skipped</Badge>
              )}
              <span className="text-sm text-content-muted dark:text-content-muted-dark">
                from {fileName}
              </span>
            </div>

            {unknownDepartments.length > 0 && (
              <Callout tone="info" title="Some departments do not exist yet">
                <p>
                  {unknownDepartments.join(', ')} — those people will be imported without
                  a department. Create the departments first if you want them assigned.
                </p>
              </Callout>
            )}

            {rejected.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-surface-border dark:border-surface-border-dark">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Rows that will be skipped</caption>
                  <thead className="bg-surface-muted dark:bg-surface-muted-dark">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Row
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Why it is being skipped
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejected.map((row) => (
                      <tr
                        key={row.line}
                        className="border-t border-surface-border dark:border-surface-border-dark"
                      >
                        <td className="px-3 py-2 align-top font-mono text-xs">
                          {row.line}
                        </td>
                        <td className="px-3 py-2 text-content-muted dark:text-content-muted-dark">
                          {row.problems.join('. ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {failure && (
              <Callout tone="danger" title="The import stopped">
                <p>{failure}</p>
                <p>
                  Anybody already added is on the team — re-importing the same file will
                  skip them rather than duplicating them.
                </p>
              </Callout>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                disabled={importing || importable.length === 0}
                onClick={() => void handleImport()}
              >
                {importing
                  ? 'Importing…'
                  : `Import ${importable.length} ${importable.length === 1 ? 'person' : 'people'}`}
              </Button>
              <Button variant="secondary" disabled={importing} onClick={reset}>
                Choose a different file
              </Button>
            </div>

            {importable.length === 0 && rejected.length > 0 && (
              <p className="flex items-start gap-2 text-sm text-content-muted dark:text-content-muted-dark">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                Every row has something to fix. Correct them in the spreadsheet and choose
                the file again.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
