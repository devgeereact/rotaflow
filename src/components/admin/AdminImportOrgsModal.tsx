import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { ScrollableCode } from '@/components/ui/ScrollableCode';
import {
  createOrganisationWithInvite,
  findExistingSlugs,
} from '@/services/platformService';
import {
  ORGANISATION_IMPORT_TEMPLATE,
  previewOrganisationImport,
  type OrganisationImportPreview,
  type OrganisationImportRow,
} from '@/lib/organisationImport';
import { downloadCsv, downloadFile } from '@/lib/csv';
import { reportError } from '@/lib/sentry';

/**
 * Bulk-create organisations from a spreadsheet.
 *
 * ## Why the button was disabled, and what replaces it
 *
 * "Bulk import is not built" — true, and the contract it needed had existed
 * since `0051`. `admin_create_organisation_with_invite` creates the
 * organisation, its subscription and an owner invitation in one transaction,
 * refuses to give the administrator a membership, and writes
 * `created_by = null`, which `limit_org_creation()` exempts from the
 * five-per-hour self-serve rate limit. So fifty rows do not trip a limit meant
 * for signup abuse.
 *
 * ## Nothing is emailed
 *
 * The single-organisation form emails the owner invite, because one person is
 * waiting on one link. An import is fifty links at once, and sending fifty
 * emails from a preview screen is the kind of irreversible fan-out nobody
 * wants to discover they triggered by testing a file. This creates the
 * organisations and the invitations, shows every link, and offers them as a
 * CSV; sending is a separate deliberate act.
 *
 * ## Why every row keeps its own outcome
 *
 * The interesting case is the partial failure: fifty rows go in, three are
 * refused. Without a per-row result the person knows only that "something
 * failed" and their only recourse is to run the file again, which creates the
 * other forty-seven a second time. Refused rows can be retried on their own.
 */

type Phase = 'choose' | 'preview' | 'running' | 'done';

interface RowOutcome {
  line: number;
  name: string;
  slug: string;
  ownerEmail: string;
  status: 'created' | 'failed' | 'skipped';
  /** The acceptance URL, shown once. Only a hash of the token is stored. */
  acceptUrl?: string;
  error?: string;
}

export function AdminImportOrgsModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (created: number) => void;
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>('choose');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<OrganisationImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [outcomes, setOutcomes] = useState<RowOutcome[]>([]);
  const [progress, setProgress] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase('choose');
    setText('');
    setPreview(null);
    setOutcomes([]);
    setProgress(0);
    setFormError(null);
  }, [open]);

  const ready = useMemo(
    () => (preview?.rows ?? []).filter((row) => row.problems.length === 0),
    [preview],
  );
  const refused = useMemo(
    () => (preview?.rows ?? []).filter((row) => row.problems.length > 0),
    [preview],
  );

  const buildPreview = useCallback(async (): Promise<void> => {
    setFormError(null);
    setChecking(true);
    try {
      // Parsed once without the database, so a malformed file is reported
      // before any query runs.
      const local = previewOrganisationImport(text);
      if (local.unrecognised) {
        setFormError(
          local.missingColumns.length > 0
            ? `The file needs a ${local.missingColumns.join(' and a ')} column.`
            : 'No rows were recognised. Check the file is comma-separated with a header row.',
        );
        setChecking(false);
        return;
      }

      const existing = await findExistingSlugs(local.rows.map((row) => row.values.slug));
      setPreview(previewOrganisationImport(text, existing));
      setPhase('preview');
    } catch (err) {
      reportError(err, { area: 'admin:import-orgs:preview' });
      setFormError(
        'The existing organisations could not be checked, so duplicates cannot be ruled out. Nothing was created.',
      );
    } finally {
      setChecking(false);
    }
  }, [text]);

  /**
   * Create the ready rows, one at a time, recording each outcome.
   *
   * Sequential rather than parallel on purpose: each call is a transaction
   * that writes an organisation, a subscription and an invitation, and firing
   * fifty at once turns one slow row into fifty timeouts. Fifty sequential
   * round trips is a few seconds, and the progress line says where it is.
   */
  const run = useCallback(
    async (rows: readonly OrganisationImportRow[]): Promise<void> => {
      setPhase('running');
      setProgress(0);
      const results: RowOutcome[] = [];

      for (const [index, row] of rows.entries()) {
        try {
          const result = await createOrganisationWithInvite({
            name: row.values.name,
            slug: row.values.slug,
            plan: row.values.plan,
            ownerEmail: row.values.ownerEmail,
            pricePence: row.values.pricePence,
          });
          results.push({
            line: row.line,
            name: row.values.name,
            slug: row.values.slug,
            ownerEmail: row.values.ownerEmail,
            status: 'created',
            acceptUrl: result.acceptUrl,
          });
        } catch (err) {
          reportError(err, { area: 'admin:import-orgs:create' });
          const conflict = (err as { code?: string } | null)?.code === '23505';
          results.push({
            line: row.line,
            name: row.values.name,
            slug: row.values.slug,
            ownerEmail: row.values.ownerEmail,
            status: 'failed',
            error: conflict
              ? 'That slug was taken between the preview and now'
              : err instanceof Error && err.message
                ? err.message
                : 'The database refused it',
          });
        }
        setProgress(index + 1);
        setOutcomes([...results]);
      }

      setOutcomes(results);
      setPhase('done');
      onImported(results.filter((r) => r.status === 'created').length);
    },
    [onImported],
  );

  const retryFailed = useCallback((): void => {
    const failedLines = new Set(
      outcomes.filter((o) => o.status === 'failed').map((o) => o.line),
    );
    const rows = (preview?.rows ?? []).filter((row) => failedLines.has(row.line));
    if (rows.length > 0) void run(rows);
  }, [outcomes, preview, run]);

  const created = outcomes.filter((o) => o.status === 'created');
  const failedOutcomes = outcomes.filter((o) => o.status === 'failed');

  return (
    <Modal open={open} onClose={onClose} title="Import organisations">
      {phase === 'choose' && (
        <div className="space-y-4">
          <Callout tone="info" title="What this does, and what it does not">
            <p className="text-sm leading-relaxed">
              Each row creates an organisation, its subscription and an owner invitation,
              in one transaction. Nothing is emailed: you get every invitation link to
              send yourself, because fifty emails is not something to trigger from a
              preview screen.
            </p>
          </Callout>

          <div>
            <label
              htmlFor="import-orgs-text"
              className="mb-1.5 block text-sm font-medium text-content dark:text-content-dark"
            >
              Paste the CSV, or choose a file
            </label>
            <textarea
              id="import-orgs-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={ORGANISATION_IMPORT_TEMPLATE}
              className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 font-mono text-xs text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Choose a CSV file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void file.text().then(setText);
              }}
              className="text-sm text-content dark:text-content-dark"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadFile(
                  'organisation-import-template.csv',
                  ORGANISATION_IMPORT_TEMPLATE,
                  'text/csv;charset=utf-8',
                )
              }
            >
              Download template
            </Button>
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-xl bg-danger-wash px-3 py-2 text-sm text-danger-ink dark:bg-danger-wash-dark dark:text-danger-ink-dark"
            >
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => void buildPreview()}
              disabled={checking || text.trim() === ''}
            >
              {checking ? 'Checking…' : 'Preview'}
            </Button>
          </div>
        </div>
      )}

      {phase === 'preview' && preview && (
        <div className="space-y-4">
          <p className="text-sm text-content dark:text-content-dark">
            {ready.length} of {preview.rows.length} rows can be created.
            {refused.length > 0 && ` ${refused.length} will be skipped.`}
          </p>

          <div className="max-h-72 overflow-y-auto rounded-xl border border-surface-border dark:border-surface-border-dark">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Import preview</caption>
              <thead className="sticky top-0 bg-surface-subtle dark:bg-surface-subtle-dark">
                <tr>
                  {['Line', 'Organisation', 'Plan', 'Owner', 'Verdict'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-[0.69rem] font-semibold uppercase tracking-[0.06em] text-content-muted dark:text-content-muted-dark"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.line}
                    className="border-t border-divider dark:border-divider-dark"
                  >
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                      {row.line}
                    </td>
                    <td className="px-3 py-2">
                      <span className="block truncate text-content dark:text-content-dark">
                        {row.values.name || '—'}
                      </span>
                      <span className="block truncate font-mono text-xs text-content-muted dark:text-content-muted-dark">
                        {row.values.slug || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-content dark:text-content-dark">
                      {row.values.plan}
                    </td>
                    <td className="truncate px-3 py-2 text-content-muted dark:text-content-muted-dark">
                      {row.values.ownerEmail || '—'}
                    </td>
                    <td className="px-3 py-2">
                      {row.problems.length === 0 ? (
                        <Badge tone="success">Ready</Badge>
                      ) : (
                        <span>
                          <Badge tone="warning">Skipped</Badge>
                          <span className="mt-1 block text-xs text-content-muted dark:text-content-muted-dark">
                            {row.problems.join('. ')}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPhase('choose')}>
              Back
            </Button>
            <Button onClick={() => void run(ready)} disabled={ready.length === 0}>
              Create {ready.length}{' '}
              {ready.length === 1 ? 'organisation' : 'organisations'}
            </Button>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="space-y-3 py-6 text-center">
          <p className="text-sm text-content dark:text-content-dark">
            Creating {progress} of {ready.length}…
          </p>
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            One transaction per organisation. Leaving this open until it finishes keeps
            the invitation links, which are shown once.
          </p>
        </div>
      )}

      {phase === 'done' && (
        <div className="space-y-4">
          <p className="text-sm text-content dark:text-content-dark">
            {created.length} created, {failedOutcomes.length} refused.
          </p>

          {created.length > 0 && (
            <Callout tone="info" title="The invitation links are shown once">
              <p className="text-sm leading-relaxed">
                RotaFlow stores only a hash of each token, so these cannot be retrieved
                again. Download them before closing this window.
              </p>
            </Callout>
          )}

          <div className="max-h-64 space-y-2 overflow-y-auto">
            {outcomes.map((outcome) => (
              <div
                key={`${outcome.line}-${outcome.slug}`}
                className="rounded-xl border border-surface-border p-2.5 dark:border-surface-border-dark"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-content dark:text-content-dark">
                    {outcome.name}
                  </span>
                  <Badge tone={outcome.status === 'created' ? 'success' : 'danger'}>
                    {outcome.status === 'created' ? 'Created' : 'Refused'}
                  </Badge>
                </div>
                {outcome.acceptUrl && (
                  <ScrollableCode
                    label={`Invitation link for ${outcome.name}`}
                    className="mt-1 block rounded-lg bg-surface-subtle px-2 py-1 font-mono text-[0.7rem] text-content dark:bg-surface-subtle-dark dark:text-content-dark"
                  >
                    {outcome.acceptUrl}
                  </ScrollableCode>
                )}
                {outcome.error && (
                  <p className="mt-1 text-xs text-danger-ink dark:text-danger-ink-dark">
                    Line {outcome.line}: {outcome.error}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {created.length > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    `organisation-invites_${new Date().toISOString().slice(0, 10)}`,
                    created,
                    [
                      { label: 'Organisation', value: (o) => o.name },
                      { label: 'Slug', value: (o) => o.slug },
                      { label: 'Owner email', value: (o) => o.ownerEmail },
                      { label: 'Invitation link', value: (o) => o.acceptUrl ?? '' },
                    ],
                    {
                      notes: [
                        'Owner invitation links, shown once. RotaFlow stores only a hash of each token.',
                        'Nothing was emailed. Send these yourself.',
                      ],
                    },
                  )
                }
              >
                Download links
              </Button>
            )}
            {failedOutcomes.length > 0 && (
              <Button variant="secondary" onClick={retryFailed}>
                Retry {failedOutcomes.length} refused
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
