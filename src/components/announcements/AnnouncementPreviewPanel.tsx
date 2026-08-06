import { Download, FileText, MapPin, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { AnnouncementIcon } from '@/components/announcements/AnnouncementIcon';
import { AnnouncementStatusPill } from '@/components/announcements/AnnouncementStatusPill';
import { engagementPercent, type AnnouncementPreview } from '@/lib/announcements';

export interface AnnouncementQuickAction {
  id: string;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

interface AnnouncementPreviewPanelProps {
  preview: AnnouncementPreview;
  /**
   * Follow-ups offered under the preview. Passed in rather than fixed so the
   * live page can offer only what the schema can actually back. See
   * `AnnouncementsPage`.
   */
  quickActions: AnnouncementQuickAction[];
  onDownload: (attachmentId: string) => void;
}

const SECTION = 'text-sm font-semibold text-content dark:text-content-dark';
// Twelfths ladder, same approach as WeeklySummaryCard: an inline `style` is
// forbidden (docs/RULES.md §4) and 8.3% granularity is finer than a 6px-tall
// bar resolves.
const WIDTHS = [
  'w-0',
  'w-1/12',
  'w-2/12',
  'w-3/12',
  'w-4/12',
  'w-5/12',
  'w-6/12',
  'w-7/12',
  'w-8/12',
  'w-9/12',
  'w-10/12',
  'w-11/12',
  'w-full',
] as const;

function widthClass(percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  return WIDTHS[Math.round((clamped / 100) * 12)] ?? 'w-0';
}

const RULE = 'my-3.5 border-t border-divider dark:border-divider-dark';
const QUICK_ACTION =
  'flex w-full items-center gap-2.5 rounded-xl border border-surface-border px-3.5 py-1.5 ' +
  'text-xs font-semibold text-primary transition-colors hover:bg-surface-subtle ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark';

/**
 * The right rail on design/Announcements-Dashboard.png. The selected
 * announcement rendered as it was sent, plus its delivery telemetry,
 * attachments and follow-up actions.
 */
export function AnnouncementPreviewPanel({
  preview,
  quickActions,
  onDownload,
}: AnnouncementPreviewPanelProps): JSX.Element {
  const percent = preview.delivery ? engagementPercent(preview.delivery) : null;

  return (
    <Card className="px-5 pb-5 pt-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className={SECTION}>Announcement Preview</h2>
        <AnnouncementStatusPill status={preview.status} />
      </div>

      <div className="mt-5 flex items-start gap-4">
        <AnnouncementIcon category={preview.category} size="xl" />
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6 text-content dark:text-content-dark">
            {preview.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-content-muted dark:text-content-muted-dark">
            {preview.sentLabel}
          </p>
          <p className="text-xs leading-5 text-content-muted dark:text-content-muted-dark">
            {preview.authorLabel}
          </p>
        </div>
      </div>

      <hr className={RULE} />

      <h3 className={SECTION}>Message</h3>
      <p className="mt-2 whitespace-pre-line text-sm leading-5 text-content-muted dark:text-content-muted-dark">
        {preview.body}
      </p>

      <hr className={RULE} />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className={SECTION}>Audience</h3>
          <p className="mt-3.5 flex items-center gap-2.5 text-xs font-medium text-content dark:text-content-dark">
            <Users
              size={16}
              aria-hidden="true"
              className="shrink-0 text-content-muted dark:text-content-muted-dark"
            />
            {preview.audience}
          </p>
          <p className="mt-3 flex items-center gap-2.5 text-xs font-medium text-content dark:text-content-dark">
            <MapPin
              size={16}
              aria-hidden="true"
              className="shrink-0 text-content-muted dark:text-content-muted-dark"
            />
            {preview.audienceScope}
          </p>
        </div>

        {preview.delivery && (
          <div className="border-l border-divider pl-4 dark:border-divider-dark">
            <h3 className={SECTION}>Delivery</h3>
            <dl className="mt-3.5 space-y-2.5 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Delivered
                </dt>
                <dd className="font-semibold text-content dark:text-content-dark">
                  {preview.delivery.delivered}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-content-muted dark:text-content-muted-dark">Read</dt>
                <dd className="font-semibold text-content dark:text-content-dark">
                  {preview.delivery.read} ({percent}%)
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Unread
                </dt>
                <dd className="font-semibold text-content dark:text-content-dark">
                  {preview.delivery.unread} ({100 - (percent ?? 0)}%)
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {percent !== null && (
        <>
          <h3 className={cn(SECTION, 'mt-8')}>Engagement</h3>
          <div className="mt-3 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label="Read rate"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 flex-1 overflow-hidden rounded-full bg-divider dark:bg-surface-subtle-dark"
            >
              <div
                className={cn('h-full rounded-full bg-success', widthClass(percent))}
              />
            </div>
            <span className="text-xs font-semibold text-content dark:text-content-dark">
              {percent}%
            </span>
          </div>
        </>
      )}

      {preview.attachments.length > 0 && (
        <>
          <hr className={cn(RULE, 'mt-6')} />
          <h3 className={SECTION}>Attached Files ({preview.attachments.length})</h3>
          <ul className="mt-3 space-y-2">
            {preview.attachments.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-xl border border-surface-border p-2 dark:border-surface-border-dark"
              >
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger"
                >
                  <FileText size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-content dark:text-content-dark">
                    {file.name}
                  </p>
                  <p className="text-[0.7rem] text-content-muted dark:text-content-muted-dark">
                    {file.meta}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDownload(file.id)}
                  aria-label={`Download ${file.name}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-content-muted transition-colors hover:bg-surface-subtle hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark"
                >
                  <Download size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <hr className={RULE} />

      <h3 className={SECTION}>Quick Actions</h3>
      <ul className="mt-3 space-y-1">
        {quickActions.map(({ id, icon: Icon, label, onSelect }) => (
          <li key={id}>
            <button type="button" onClick={onSelect} className={QUICK_ACTION}>
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
