import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import {
  AnnouncementFilterBar,
  type AnnouncementFilterSelect,
} from '@/components/announcements/AnnouncementFilterBar';
import { AnnouncementPagination } from '@/components/announcements/AnnouncementPagination';
import {
  AnnouncementPreviewPanel,
  type AnnouncementQuickAction,
} from '@/components/announcements/AnnouncementPreviewPanel';
import { AnnouncementTable } from '@/components/announcements/AnnouncementTable';
import {
  AnnouncementTabs,
  type AnnouncementTabDef,
} from '@/components/announcements/AnnouncementTabs';
import { AnnouncementTipBanner } from '@/components/announcements/AnnouncementTipBanner';
import type {
  AnnouncementPreview,
  AnnouncementRow,
  AnnouncementTab,
} from '@/lib/announcements';

export interface AnnouncementsViewProps {
  tabs: AnnouncementTabDef[];
  activeTab: AnnouncementTab;
  onTabChange: (tab: AnnouncementTab) => void;
  /** Omitted for staff, who read announcements but never compose them. */
  onNewAnnouncement?: () => void;

  search: string;
  onSearchChange: (value: string) => void;
  selects: AnnouncementFilterSelect[];
  onFilters: () => void;

  rows: AnnouncementRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onMenu: (id: string) => void;
  emptyMessage: string;

  page: number;
  pageCount: number;
  rangeFrom: number;
  rangeTo: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;

  /** `null` while nothing is selected. The rail collapses rather than showing a shell. */
  preview: AnnouncementPreview | null;
  quickActions: AnnouncementQuickAction[];
  onDownload: (attachmentId: string) => void;
  onViewGuide: () => void;
}

/**
 * `/app/announcements`. Compose, schedule and track team communications
 * (design/Announcements-Dashboard.png).
 *
 * Presentational only: rows, counts and the preview arrive already mapped, so
 * the live page and the design preview render the identical tree.
 */
export function AnnouncementsView(props: AnnouncementsViewProps): JSX.Element {
  return (
    <div>
      <div>
        <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
          Announcements
        </h1>
        <p className="mt-1 text-base text-content-muted dark:text-content-muted-dark">
          Communicate important updates to your team.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <AnnouncementTabs
          tabs={props.tabs}
          active={props.activeTab}
          onChange={props.onTabChange}
        />
        {props.onNewAnnouncement && (
          <button
            type="button"
            onClick={props.onNewAnnouncement}
            className="flex h-10 items-center gap-2.5 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-fg transition-transform duration-150 ease-in-out hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus size={18} aria-hidden="true" />
            New Announcement
          </button>
        )}
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
        {/* `mt-1` nudges the filter row onto the reference's baseline; the rail
            beside it starts flush with the grid. */}
        <div className="mt-1 min-w-0">
          <AnnouncementFilterBar
            search={props.search}
            onSearchChange={props.onSearchChange}
            selects={props.selects}
            onFilters={props.onFilters}
          />

          <Card className="mt-7 overflow-hidden p-0">
            <div className="overflow-x-auto">
              <AnnouncementTable
                rows={props.rows}
                selectedId={props.selectedId}
                onSelect={props.onSelect}
                onEdit={props.onEdit}
                onMenu={props.onMenu}
                emptyMessage={props.emptyMessage}
              />
            </div>
            {props.total > 0 && (
              <AnnouncementPagination
                page={props.page}
                pageCount={props.pageCount}
                from={props.rangeFrom}
                to={props.rangeTo}
                total={props.total}
                pageSize={props.pageSize}
                onPageChange={props.onPageChange}
                onPageSizeChange={props.onPageSizeChange}
              />
            )}
          </Card>

          <div className="mt-7">
            <AnnouncementTipBanner onAction={props.onViewGuide} />
          </div>
        </div>

        {props.preview && (
          <aside>
            <AnnouncementPreviewPanel
              preview={props.preview}
              quickActions={props.quickActions}
              onDownload={props.onDownload}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
