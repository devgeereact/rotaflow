import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Callout';
import { FilterBar } from '@/components/ui/FilterBar';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ScrollRegion } from '@/components/ui/ScrollRegion';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { useFilterState } from '@/hooks/useFilterState';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { useToast } from '@/hooks/useToast';
import {
  ENQUIRY_STATUSES,
  ENQUIRY_STATUS_LABEL,
  ENQUIRY_STATUS_TONE,
  isEnquiryStatus,
  type EnquiryRecord,
  type EnquiryStatus,
} from '@/lib/enquiry';
import {
  filterValue,
  matchesFilters,
  matchesSearch,
  type FilterDimension,
  type FilterOption,
} from '@/lib/filters';
import { reportError } from '@/lib/sentry';
import { listEnquiries, setEnquiryStatus } from '@/services/enquiryService';

/**
 * `/admin/enquiries`. The inbox for the website contact form (0155).
 *
 * Operational roles only (owner, admin, support): `enquiries_select` is
 * `is_platform_operational()`, and the route and the nav entry carry the same
 * gate so finance is not shown an empty inbox. Deliberately not a CRM: one
 * status per enquiry, New, Replied, Demo booked or Closed, and replies happen
 * in the team's own mailbox. Rows are removed 24 months after they arrive.
 */

const FILTERS: readonly FilterDimension[] = [
  // `sensitive`: the search is over prospects' names and addresses, which do
  // not belong in a URL somebody pastes into a ticket.
  { id: 'q', label: 'Search', kind: 'text', sensitive: true },
  { id: 'status', label: 'Status', kind: 'multi' },
] as const;

const STATUS_OPTIONS: readonly FilterOption[] = ENQUIRY_STATUSES.map((value) => ({
  value,
  label: ENQUIRY_STATUS_LABEL[value],
}));

const ACCESSORS = { status: (item: { status: string }) => item.status };

function optionsFor(dimensionId: string): readonly FilterOption[] {
  return dimensionId === 'status' ? STATUS_OPTIONS : [];
}

const COLUMNS = [
  'Received',
  'From',
  'Organisation',
  'Team',
  'Demo',
  'Status',
  '',
] as const;

function received(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminEnquiriesPage(): JSX.Element {
  const [rows, setRows] = useState<EnquiryRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const filterApi = useFilterState({ dimensions: FILTERS, scopeKey: 'platform' });
  const filters = filterApi.filters;

  useEffect(() => {
    let active = true;
    setFailed(false);
    setRows(null);
    void (async () => {
      try {
        const data = await listEnquiries();
        if (active) setRows(data);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:enquiries' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const all = useMemo(() => rows ?? [], [rows]);
  const visible = useMemo(
    () =>
      all.filter(
        (item) =>
          matchesFilters(item, filters, ACCESSORS) &&
          matchesSearch(
            [item.name, item.workEmail, item.organisation, item.sector],
            filterValue(filters, 'q'),
          ),
      ),
    [all, filters],
  );

  const counts = useMemo(
    () => ({
      new: all.filter((e) => e.status === 'new').length,
      demoWaiting: all.filter((e) => e.wantsDemo && e.status === 'new').length,
      booked: all.filter((e) => e.status === 'demo_booked').length,
      total: all.length,
    }),
    [all],
  );

  const open = openId ? (all.find((e) => e.id === openId) ?? null) : null;

  const onStatusChanged = (id: string, status: EnquiryStatus): void => {
    setRows((prev) =>
      prev ? prev.map((e) => (e.id === id ? { ...e, status } : e)) : prev,
    );
  };

  return (
    <AdminPage
      title="Enquiries"
      description="Messages from the contact form on the website. Reply from your own mailbox, then record where each one stands."
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !rows ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile label="New" value={counts.new} hint="Not answered yet" />
            <StatTile
              label="Asked for a demo"
              value={counts.demoWaiting}
              hint="New, demo box ticked"
            />
            <StatTile label="Demos booked" value={counts.booked} />
            <StatTile label="All enquiries" value={counts.total} hint="Kept 24 months" />
          </TileGrid>

          <Card className="p-0">
            <div className="border-b border-divider p-3 dark:border-divider-dark">
              <FilterBar
                dimensions={FILTERS}
                filters={filters}
                optionsFor={optionsFor}
                onSetValue={filterApi.setValue}
                onSetValues={filterApi.setValues}
                onClearOne={filterApi.clearOne}
                onClearAll={filterApi.clearAll}
                searchPlaceholder="Search name, email or organisation"
                resultSummary={`${visible.length} of ${all.length}`}
              />
            </div>

            <ScrollRegion label="Enquiries">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <caption className="sr-only">Website enquiries, newest first</caption>
                <thead>
                  <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                    {COLUMNS.map((heading, i) => (
                      <th
                        key={heading || `col-${i}`}
                        scope="col"
                        className="px-3 py-2.5 text-left text-[0.69rem] font-semibold uppercase tracking-[0.06em] text-content-muted first:pl-4 dark:text-content-muted-dark"
                      >
                        {heading || <span className="sr-only">Actions</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td
                        colSpan={COLUMNS.length}
                        className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark"
                      >
                        {all.length === 0
                          ? 'No enquiries yet. Messages sent from the contact page appear here.'
                          : 'No enquiry matches these filters.'}
                      </td>
                    </tr>
                  ) : (
                    visible.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-divider last:border-0 dark:border-divider-dark"
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 pl-4 text-content-muted dark:text-content-muted-dark">
                          {received(item.createdAt)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="block font-medium text-content dark:text-content-dark">
                            {item.name}
                          </span>
                          <span className="block break-all text-xs text-content-muted dark:text-content-muted-dark">
                            {item.workEmail}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-content dark:text-content-dark">
                          {item.organisation}
                          {item.sector && (
                            <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                              {item.sector}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-content dark:text-content-dark">
                          {item.teamSize ?? 'Not given'}
                        </td>
                        <td className="px-3 py-2.5">
                          {item.wantsDemo ? <Badge tone="info">Demo</Badge> : 'No'}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={ENQUIRY_STATUS_TONE[item.status]} dot>
                            {ENQUIRY_STATUS_LABEL[item.status]}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setOpenId(item.id)}
                            aria-label={`Open the enquiry from ${item.name}`}
                          >
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollRegion>
          </Card>

          <Callout tone="info" title="Where these come from">
            <p>
              Each row is one message sent from the contact page, stored by the{' '}
              <code>public-enquiry</code> function after it passed validation and the rate
              limit. Marketing consent is recorded as the visitor left it: unticked means
              reply to this message only.
            </p>
          </Callout>
        </div>
      )}

      {open && (
        <EnquiryDetail
          key={open.id}
          enquiry={open}
          onClose={() => setOpenId(null)}
          onSaved={onStatusChanged}
        />
      )}
    </AdminPage>
  );
}

function EnquiryDetail({
  enquiry,
  onClose,
  onSaved,
}: {
  enquiry: EnquiryRecord;
  onClose: () => void;
  onSaved: (id: string, status: EnquiryStatus) => void;
}): JSX.Element {
  const [status, setStatus] = useState<EnquiryStatus>(enquiry.status);
  const [saving, setSaving] = useState(false);
  const { showSuccess, showError } = useToast();
  const dirty = status !== enquiry.status;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await setEnquiryStatus(enquiry.id, status);
      onSaved(enquiry.id, status);
      showSuccess(`Marked as ${ENQUIRY_STATUS_LABEL[status].toLowerCase()}.`);
      onClose();
    } catch (err) {
      reportError(err, { area: 'admin:enquiries:status' });
      showError('The status could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const mailto = `mailto:${enquiry.workEmail}?subject=${encodeURIComponent(
    'Your enquiry to RotaFlow',
  )}`;

  return (
    <Modal open onClose={onClose} title={`Enquiry from ${enquiry.name}`} dirty={dirty}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-content-muted dark:text-content-muted-dark">Received</dt>
        <dd className="text-content dark:text-content-dark">
          {received(enquiry.createdAt)}
        </dd>
        <dt className="text-content-muted dark:text-content-muted-dark">Email</dt>
        <dd className="break-all">
          <a
            href={mailto}
            className="font-medium text-primary-ink underline underline-offset-2 dark:text-primary-ink-dark"
          >
            {enquiry.workEmail}
          </a>
        </dd>
        <dt className="text-content-muted dark:text-content-muted-dark">Organisation</dt>
        <dd className="text-content dark:text-content-dark">{enquiry.organisation}</dd>
        <dt className="text-content-muted dark:text-content-muted-dark">Team size</dt>
        <dd className="text-content dark:text-content-dark">
          {enquiry.teamSize ?? 'Not given'}
        </dd>
        <dt className="text-content-muted dark:text-content-muted-dark">Sector</dt>
        <dd className="text-content dark:text-content-dark">
          {enquiry.sector ?? 'Not given'}
        </dd>
        <dt className="text-content-muted dark:text-content-muted-dark">Demo</dt>
        <dd className="text-content dark:text-content-dark">
          {enquiry.wantsDemo ? 'Asked for a demo' : 'No'}
        </dd>
        <dt className="text-content-muted dark:text-content-muted-dark">Marketing</dt>
        <dd className="text-content dark:text-content-dark">
          {enquiry.marketingConsent
            ? 'Agreed to occasional emails'
            : 'Not agreed. Reply to this message only'}
        </dd>
      </dl>

      <h3 className="mt-5 text-sm font-semibold text-content dark:text-content-dark">
        Message
      </h3>
      {/* Rendered as text: React escapes it, and nothing here interprets
          markup or links in what a stranger typed. */}
      <p className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-surface-border bg-surface-subtle p-3 text-sm text-content dark:border-surface-border-dark dark:bg-surface-subtle-dark dark:text-content-dark">
        {enquiry.message}
      </p>

      <Field label="Status" className="mt-5">
        <Select
          value={status}
          onChange={(e) => {
            if (isEnquiryStatus(e.target.value)) setStatus(e.target.value);
          }}
        >
          {ENQUIRY_STATUSES.map((value) => (
            <option key={value} value={value}>
              {ENQUIRY_STATUS_LABEL[value]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save status'}
        </Button>
      </div>
    </Modal>
  );
}
