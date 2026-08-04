import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, KeyRound } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RequestSupportAccessModal } from '@/components/admin/RequestSupportAccessModal';
import { useToast } from '@/hooks/useToast';
import { requestSupportAccess } from '@/services/supportAccessService';
import { Input } from '@/components/ui/Input';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
} from '@/components/admin/AdminPage';
import { countMembershipsByOrg, listAllOrganisations } from '@/services/platformService';
import { reportError } from '@/lib/sentry';
import type { Organisation } from '@/types';

/**
 * `/admin/support` — NEW_STRUCTURE §34's support tools.
 *
 * Find a tenant, see its size, open a support session against it.
 *
 * ## This screen used to say support access was not built
 *
 * It carried a warning card explaining that `support_access_sessions` was
 * named in the spec and existed in no migration, so there was nothing to
 * grant or expire. That was true and worth saying — right up until 0019
 * created the table, at which point the card became a false statement shown
 * to platform staff on the screen where they would act on it.
 *
 * A caveat that outlives the gap it described is worse than no caveat: people
 * stop reading them. So the card is gone and the action is here instead.
 *
 * What has *not* changed is the thing the old card was really warning about,
 * and it is still stated below: a platform administrator's standing
 * cross-tenant read comes from `has_platform_role`, not from a session. Opening
 * a session records why you looked; it is not what lets you look.
 */
export function AdminSupportPage(): JSX.Element {
  const [organisations, setOrganisations] = useState<Organisation[] | null>(null);
  const [members, setMembers] = useState<Map<string, number>>(new Map());
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [requestFor, setRequestFor] = useState<Organisation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { showError, showSuccess } = useToast();

  useEffect(() => {
    let active = true;
    setFailed(false);
    setOrganisations(null);
    void (async () => {
      try {
        const [orgs, counts] = await Promise.all([
          listAllOrganisations(),
          countMembershipsByOrg(),
        ]);
        if (!active) return;
        setOrganisations(orgs);
        setMembers(counts);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:support' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const visible = useMemo(() => {
    if (!organisations) return [];
    const q = search.trim().toLowerCase();
    if (!q) return organisations.slice(0, 20);
    return organisations.filter(
      (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
    );
  }, [organisations, search]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <AdminPage
      title="Support tools"
      description="Find a customer's organisation when you are helping them."
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !organisations ? (
        <AdminLoading />
      ) : (
        <div className="space-y-6">
          <Card className="border-warning/30 bg-warning/5">
            <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
              Opening a session records why you looked — it is not what lets you look
            </h2>
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Your platform role already grants standing read access to every organisation
              through row-level security. A support session does not switch that on; it
              time-boxes and justifies a particular piece of it, and the customer sees a
              banner in their own app naming you while it is open.
            </p>
            <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
              Open one whenever you are about to look at a specific customer&rsquo;s data
              on their behalf.{' '}
              <Link
                to="/admin/support-access"
                className="font-medium text-primary hover:underline"
              >
                Review every session
              </Link>
              .
            </p>
          </Card>

          <div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search organisations…"
              aria-label="Search organisations"
              className="max-w-sm"
            />
            <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
              {search.trim()
                ? `${visible.length} match${visible.length === 1 ? '' : 'es'}.`
                : `Showing the ${visible.length} most recent of ${organisations.length}. Search to find others.`}
            </p>
          </div>

          {visible.length === 0 ? (
            <AdminEmpty message="No organisation matches that search." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((org) => (
                <Card key={org.id}>
                  <p className="truncate font-medium text-content dark:text-content-dark">
                    {org.name}
                  </p>
                  <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                    {org.slug}
                  </p>
                  <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
                    {members.get(org.id) ?? 0} active member
                    {(members.get(org.id) ?? 0) === 1 ? '' : 's'} · created{' '}
                    {new Date(org.created_at).toLocaleDateString('en-GB')}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRequestFor(org)}
                    >
                      <KeyRound size={14} aria-hidden="true" />
                      Support access
                    </Button>
                    <Link
                      to="/admin/audit"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Audit events
                      <ExternalLink size={13} aria-hidden="true" />
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <RequestSupportAccessModal
        open={requestFor !== null}
        orgs={organisations ?? []}
        initialOrgId={requestFor?.id ?? ''}
        busy={submitting}
        onClose={() => setRequestFor(null)}
        onSubmit={async (input) => {
          setSubmitting(true);
          try {
            await requestSupportAccess(input);
            showSuccess(
              'Support access opened. The customer can see it in their own app.',
            );
            setRequestFor(null);
          } catch (error) {
            // The database refuses when a customer has turned support access
            // off, and that refusal carries a sentence worth showing verbatim.
            showError(
              error instanceof Error
                ? error.message
                : 'Could not open a support session.',
            );
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </AdminPage>
  );
}
