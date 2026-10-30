import { useCallback, useEffect, useState, type ChangeEvent, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  CircleCheck,
  ExternalLink,
  FileClock,
  FileWarning,
  ShieldCheck,
  TriangleAlert,
  UserX,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatTile } from '@/components/ui/StatTile';
import { DocumentsModal } from '@/components/staff/DocumentsModal';
import {
  complianceSummary,
  documentOpenUrl,
  myCompliance,
  reviewDocument,
  reviewQueue,
  STAFF_DOCUMENTS_FEATURE,
  type MyCompliance,
  type OrgComplianceSummary,
  type QueuedDocument,
} from '@/services/documentService';
import { REQUIREMENT_LABELS, statusTone } from '@/lib/compliance';
import { ApiError } from '@/lib/api';
import { reportError } from '@/lib/sentry';

/**
 * `/app/compliance` (R2, slice S10). Everyone sees what is required of them and keeps their own
 * documents here; owners and managers also get the review queue and the organisation's numbers by
 * type. Approving is four-eyes: nobody approves their own document, and a manager cannot approve a
 * document they uploaded for someone else (an owner can). The API enforces it; the queue says so
 * on the button rather than letting someone find out by pressing it.
 *
 * Behind the `staff_documents` feature flag, so the module can ship dark.
 */
export function CompliancePage(): JSX.Element {
  const { orgId, role } = useOrg();
  const features = useFeatureAccess();
  const enabled = features.has(STAFF_DOCUMENTS_FEATURE);
  const manages = role === 'owner' || role === 'manager';
  const { showError, showSuccess } = useToast();

  const [me, setMe] = useState<MyCompliance | null>(null);
  const [summary, setSummary] = useState<OrgComplianceSummary | null>(null);
  const [queue, setQueue] = useState<QueuedDocument[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [myDocsOpen, setMyDocsOpen] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!orgId || !enabled) return;
    let active = true;
    setFailed(false);
    void (async () => {
      try {
        const [mine, sum, q] = await Promise.all([
          myCompliance(orgId),
          manages ? complianceSummary(orgId) : Promise.resolve(null),
          manages ? reviewQueue(orgId) : Promise.resolve([]),
        ]);
        if (!active) return;
        setMe(mine);
        setSummary(sum);
        setQueue(q);
      } catch (err) {
        reportError(err, { area: 'compliance:load' });
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, enabled, manages, reloadKey]);

  const decide = async (
    doc: QueuedDocument,
    decision: 'approve' | 'reject',
  ): Promise<void> => {
    if (!orgId) return;
    setBusy(true);
    try {
      await reviewDocument(
        orgId,
        doc,
        decision,
        decision === 'reject' ? reason.trim() : undefined,
      );
      showSuccess(
        decision === 'approve'
          ? `${doc.type} approved for ${doc.staff_name}.`
          : `${doc.type} returned to ${doc.staff_name}.`,
      );
      setRejecting(null);
      setReason('');
      reload();
    } catch (err) {
      reportError(err, { area: 'compliance:review' });
      showError(
        err instanceof ApiError && err.message
          ? err.message
          : 'That review could not be saved.',
      );
      reload();
    } finally {
      setBusy(false);
    }
  };

  const open = async (doc: QueuedDocument): Promise<void> => {
    if (!orgId) return;
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const url = await documentOpenUrl(orgId, doc.id);
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      win?.close();
      reportError(err, { area: 'compliance:open' });
      showError('Could not open that document.');
    }
  };

  const title = manages ? 'Compliance' : 'My documents';

  if (features.loading) return <LoadingState label="Loading" />;
  if (!enabled) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} />
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="Staff documents are not switched on"
            description="This part of RotaFlow is not available for your organisation yet."
          />
        </Card>
      </div>
    );
  }

  const muted = 'text-sm text-content-muted dark:text-content-muted-dark';

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={
          manages
            ? 'Documents waiting for review, and who is cleared to work. A document counts only once someone other than its owner approves it.'
            : 'What your organisation requires you to keep on file, and where each one stands.'
        }
        actions={
          manages ? (
            <Link
              to="/app/settings/document-types"
              className="text-sm font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
            >
              Document types
            </Link>
          ) : undefined
        }
      />

      {failed ? (
        <Card>
          <EmptyState
            icon={TriangleAlert}
            title="Compliance could not be loaded"
            description="Check your connection and try again."
            action={<Button onClick={reload}>Try again</Button>}
          />
        </Card>
      ) : me === null ? (
        <LoadingState label="Loading compliance" />
      ) : (
        <>
          {manages && summary && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                icon={FileClock}
                label="Awaiting review"
                value={summary.counts.awaiting_review}
              />
              <StatTile
                icon={FileWarning}
                label="Expiring in 30 days"
                value={summary.counts.expiring}
              />
              <StatTile
                icon={TriangleAlert}
                label="Expired"
                value={summary.counts.expired}
              />
              <StatTile
                icon={UserX}
                label="People not cleared"
                value={summary.counts.not_eligible}
                suffix={`of ${summary.counts.people}`}
              />
            </div>
          )}

          {manages && (
            <Card>
              <h2 className="mb-3 text-base font-semibold text-content dark:text-content-dark">
                Review queue
              </h2>
              {queue.length === 0 ? (
                <EmptyState
                  icon={CircleCheck}
                  title="Nothing waiting"
                  description="Documents your staff send for review appear here, oldest first."
                />
              ) : (
                <ul className="space-y-3">
                  {queue.map((doc) => (
                    <li
                      key={doc.id}
                      className="rounded-xl border border-surface-border p-3 dark:border-surface-border-dark"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-content dark:text-content-dark">
                            {doc.staff_name}: {doc.type}
                          </p>
                          <p className={muted}>
                            {doc.name}
                            {doc.issued_at && ` · issued ${doc.issued_at}`}
                            {doc.expires_at
                              ? ` · expires ${doc.expires_at}`
                              : ' · no expiry'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void open(doc)}
                          >
                            <ExternalLink
                              size={14}
                              aria-hidden="true"
                              className="mr-1.5"
                            />
                            Open
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy || !doc.can_approve}
                            title={
                              doc.can_approve
                                ? undefined
                                : doc.own
                                  ? 'Someone else must review your own documents'
                                  : 'You uploaded this, so someone else must approve it'
                            }
                            onClick={() => void decide(doc, 'approve')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || doc.own}
                            title={
                              doc.own
                                ? 'Someone else must review your own documents'
                                : undefined
                            }
                            onClick={() => {
                              setRejecting(doc.id);
                              setReason('');
                            }}
                          >
                            Not accepted
                          </Button>
                        </div>
                      </div>
                      {rejecting === doc.id && (
                        <div className="mt-3 flex flex-wrap items-end gap-2">
                          <div className="min-w-0 flex-1">
                            <label htmlFor={`reason-${doc.id}`} className={muted}>
                              Reason, sent to the person
                            </label>
                            <Input
                              id={`reason-${doc.id}`}
                              value={reason}
                              maxLength={500}
                              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                setReason(e.target.value)
                              }
                            />
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || reason.trim().length < 3}
                            onClick={() => void decide(doc, 'reject')}
                          >
                            Send back
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRejecting(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {manages && summary && summary.by_type.length > 0 && (
            <Card>
              <h2 className="mb-3 text-base font-semibold text-content dark:text-content-dark">
                Required documents by type
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className={muted}>
                    <tr>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Approved</th>
                      <th className="py-2 pr-3 font-medium">Expiring</th>
                      <th className="py-2 pr-3 font-medium">Expired</th>
                      <th className="py-2 pr-3 font-medium">Awaiting review</th>
                      <th className="py-2 font-medium">Missing</th>
                    </tr>
                  </thead>
                  <tbody className="text-content dark:text-content-dark">
                    {summary.by_type.map((t) => (
                      <tr
                        key={t.type_id}
                        className="border-t border-surface-border dark:border-surface-border-dark"
                      >
                        <td className="py-2 pr-3 font-medium">{t.name}</td>
                        <td className="py-2 pr-3">{t.approved}</td>
                        <td className="py-2 pr-3">{t.expiring}</td>
                        <td className="py-2 pr-3">{t.expired}</td>
                        <td className="py-2 pr-3">{t.awaiting_review}</td>
                        <td className="py-2">{t.missing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-content dark:text-content-dark">
                {manages ? 'Your own documents' : 'What is required of you'}
              </h2>
              {me.staff_profile_id && (
                <Button size="sm" variant="secondary" onClick={() => setMyDocsOpen(true)}>
                  Upload or manage
                </Button>
              )}
            </div>
            {me.staff_profile_id === null ? (
              <p className={muted}>
                You have no staff record here, so no documents are required of you.
              </p>
            ) : me.requirements.length === 0 ? (
              <p className={muted}>Nothing is required of you at the moment.</p>
            ) : (
              <ul className="space-y-2">
                {me.requirements.map((r) => (
                  <li key={r.type_id} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-content dark:text-content-dark">
                      {r.name}
                      {r.expires_at && (
                        <span className={muted}> · expires {r.expires_at}</span>
                      )}
                    </span>
                    <Badge tone={statusTone(r.state)}>
                      {REQUIREMENT_LABELS[r.state]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {me.staff_profile_id && (
              <p className={`mt-3 ${muted}`}>
                {me.counts.eligible
                  ? 'You are cleared to work.'
                  : 'Until every required document is approved and in date, a manager will see that you are not cleared.'}
              </p>
            )}
          </Card>
        </>
      )}

      {orgId && me?.staff_profile_id && (
        <DocumentsModal
          open={myDocsOpen}
          onClose={() => setMyDocsOpen(false)}
          orgId={orgId}
          staffProfileId={me.staff_profile_id}
          staffName="you"
          title="Your documents"
          canManage={manages}
          onChanged={reload}
        />
      )}
    </div>
  );
}
