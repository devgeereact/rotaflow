import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { reportError } from '@/lib/sentry';
import { formatDate } from '@/lib/format';
import {
  GDPR_STATUS_LABELS,
  OWN_KIND_LABELS,
  SELF_SERVICE_REQUESTS,
  effectiveDueDate,
  isClosed,
  type GdprRequestStatus,
  type OwnDataRequest,
  type SelfServiceRequestOption,
} from '@/lib/gdprRequests';
import { listMyDataRequests, requestMyData } from '@/services/gdprRequestService';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SettingsSection } from '@/components/settings/SettingsSection';

const STATUS_TONE: Record<GdprRequestStatus, BadgeTone> = {
  received: 'info',
  in_progress: 'info',
  awaiting_information: 'warning',
  completed: 'success',
  refused: 'neutral',
};

/**
 * `/app/account/data`. A person's own UK GDPR rights (GAP-057).
 *
 * ## Why a request and not a download button
 *
 * A manager can already export one person's record (`gdprService.ts`), and an
 * owner can anonymise them. Handing the same export straight to the person is
 * tempting and wrong: the employer is the controller of a staff record, some of
 * it (a manager's notes, another person's name on a swap) is not the
 * requester's to receive unreviewed, and erasure has to leave the pay and hours
 * an employer must keep. So every button here files a case in the register
 * `0020` built, where the one-month deadline is computed by the database and a
 * case cannot be closed without saying what was done. `request_my_data` (`0160`)
 * takes the subject from the signed-in account, so nothing here can name
 * anybody else.
 *
 * The list below shows the person's own requests: kind, status and dates. Not
 * the outcome note, which is written for the case file; the answer reaches them
 * by email.
 */
export function YourDataPage(): JSX.Element {
  const { orgId } = useOrg();
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [requests, setRequests] = useState<OwnDataRequest[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const found = await listMyDataRequests();
        if (active) {
          setRequests(found);
          setLoadFailed(false);
        }
      } catch (err) {
        reportError(err, { area: 'account-data:list' });
        if (active) setLoadFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const handleRequest = useCallback(
    async (option: SelfServiceRequestOption): Promise<void> => {
      const erasure = option.kind === 'erasure';
      const ok = await confirm({
        title: erasure ? 'Ask to close your account?' : `${option.action}?`,
        message: erasure
          ? 'We will check who you are, then close your account and erase your personal data within one month. Records an employer must keep by law stay with them. Until then, nothing changes.'
          : 'We will reply by email to the address on this account within one month.',
        confirmLabel: option.action,
        tone: erasure ? 'danger' : 'primary',
      });
      if (!ok) return;

      setWorking(option.kind);
      try {
        const result = await requestMyData(option.kind, orgId);
        showSuccess(
          result.alreadyOpen
            ? `You already asked for this. We will answer by ${formatDate(result.dueOn)}.`
            : `Request received. We will answer by ${formatDate(result.dueOn)}.`,
        );
        setReloadKey((k) => k + 1);
      } catch (err) {
        reportError(err, { area: 'account-data:request', kind: option.kind });
        showError(
          'Your request could not be sent. Please try again, or write to support@rotaflow.space.',
        );
      } finally {
        setWorking(null);
      }
    },
    [confirm, orgId, showError, showSuccess],
  );

  return (
    <div className="max-w-3xl space-y-6">
      <SettingsSection
        title="Your data"
        description="Ask for a copy of what RotaFlow holds about you, a correction, or for your account to be closed. Each request is answered within one month."
      >
        <ul className="divide-y divide-divider dark:divide-divider-dark">
          {SELF_SERVICE_REQUESTS.map((option) => (
            <li
              key={option.kind}
              className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-content dark:text-content-dark">
                  {option.title}
                </p>
                <p className="mt-0.5 text-sm text-content-muted dark:text-content-muted-dark">
                  {option.description}
                </p>
              </div>
              <Button
                variant={option.kind === 'erasure' ? 'danger-outline' : 'secondary'}
                disabled={working !== null}
                onClick={() => void handleRequest(option)}
              >
                {working === option.kind ? 'Sending…' : option.action}
              </Button>
            </li>
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection
        title="Your requests"
        description="What you have asked for and when we will answer. The answer itself comes by email."
      >
        {loadFailed ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Your requests could not be listed just now. Any request you send still reaches
            us.
          </p>
        ) : requests === null ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            You have not made a request.
          </p>
        ) : (
          <ul className="divide-y divide-divider dark:divide-divider-dark">
            {requests.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-content dark:text-content-dark">
                    {OWN_KIND_LABELS[request.kind]}
                  </p>
                  <p className="mt-0.5 text-xs text-content-muted dark:text-content-muted-dark">
                    Asked {formatDate(request.receivedOn)}
                    {isClosed(request.status)
                      ? request.closedAt
                        ? ` · closed ${formatDate(request.closedAt.slice(0, 10))}`
                        : ''
                      : ` · answer due by ${formatDate(effectiveDueDate(request))}`}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[request.status]} dot>
                  {GDPR_STATUS_LABELS[request.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
