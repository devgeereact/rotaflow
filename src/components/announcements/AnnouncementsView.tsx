import { Pin, Plus } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AnnouncementCard, ReachRow } from '@/lib/announcementsMapping';

export interface AnnouncementsViewProps {
  cards: AnnouncementCard[];
  reach: ReachRow[];
  loading: boolean;
  canManage: boolean;
  canPost: boolean;
  busyId: string | null;
  onNewAnnouncement: () => void;
  onRemindUnread: (card: AnnouncementCard) => void;
  onTakeDown: (card: AnnouncementCard) => void;
  onMarkRead: (card: AnnouncementCard) => void;
}

/**
 * `/app/announcements` (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.announcements`): a card feed with a manager-only "Reach" rail. No
 * table, no tab bar, no CSV export — `createAnnouncement` always sets
 * `published_at` immediately, so the reference's own Scheduled/Drafts tabs
 * had nothing to ever show.
 */
export function AnnouncementsView({
  cards,
  reach,
  loading,
  canManage,
  canPost,
  busyId,
  onNewAnnouncement,
  onRemindUnread,
  onTakeDown,
  onMarkRead,
}: AnnouncementsViewProps): JSX.Element {
  const maxReach = Math.max(1, ...reach.map((r) => r.count));

  return (
    <div>
      <WorkspaceHeader
        title="Announcements"
        subtitle={
          canManage
            ? 'What you post here reaches staff in the app. Read counts tell you whether it landed.'
            : 'Notices from your managers. Anything pinned stays at the top until it is taken down.'
        }
        actions={
          canPost && (
            <Button onClick={onNewAnnouncement}>
              <Plus size={16} aria-hidden="true" className="mr-1.5" />
              New announcement
            </Button>
          )
        }
      />

      <div className={canManage ? 'grid gap-4 xl:grid-cols-[2fr_1fr]' : ''}>
        <div className="space-y-4">
          {loading ? (
            <Card>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Loading…
              </p>
            </Card>
          ) : cards.length === 0 ? (
            <Card>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                No announcements yet.
              </p>
            </Card>
          ) : (
            cards.map((card) => {
              const unread = Math.max(0, card.audienceSize - card.readCount);
              return (
                <Card key={card.id}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {card.pinned && (
                      <Badge tone="warning">
                        <Pin size={11} aria-hidden="true" className="mr-1" />
                        Pinned
                      </Badge>
                    )}
                    <Badge tone="neutral">{card.audienceLabel}</Badge>
                    <span className="ml-auto text-xs text-content-muted dark:text-content-muted-dark">
                      {card.authorName} · {card.when}
                    </span>
                  </div>
                  <h3 className="mb-1.5 font-semibold text-content dark:text-content-dark">
                    {card.title}
                  </h3>
                  <p className="mb-3 whitespace-pre-line text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                    {card.body}
                  </p>

                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="grid grid-cols-[40px_7.5rem_auto] items-center gap-2">
                        <span className="text-xs text-content-muted dark:text-content-muted-dark">
                          Read
                        </span>
                        <span className="h-2 overflow-hidden rounded-full border border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{
                              width:
                                card.audienceSize === 0
                                  ? '0%'
                                  : `${Math.min(100, (card.readCount / card.audienceSize) * 100)}%`,
                            }}
                          />
                        </span>
                        <span className="font-mono text-xs text-content dark:text-content-dark">
                          {card.readCount}/{card.audienceSize}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="ml-auto"
                        disabled={busyId === card.id || unread === 0}
                        onClick={() => onRemindUnread(card)}
                      >
                        Remind {unread} unread
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === card.id}
                        onClick={() => onTakeDown(card)}
                      >
                        Take down
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={card.isReadByViewer || busyId === card.id}
                      onClick={() => onMarkRead(card)}
                    >
                      {card.isReadByViewer ? 'Marked as read' : 'Mark as read'}
                    </Button>
                  )}
                </Card>
              );
            })
          )}
        </div>

        {canManage && (
          <Card className="self-start">
            <h2 className="mb-3 font-semibold text-content dark:text-content-dark">
              Reach
            </h2>
            {reach.length === 0 ? (
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                No staff yet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {reach.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[88px_1fr_40px] items-center gap-2.5"
                  >
                    <span className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                      {row.label}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full border border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(row.count / maxReach) * 100}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-xs text-content dark:text-content-dark">
                      {row.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-content-muted dark:text-content-muted-dark">
              Audiences are built from department and site, so a new starter joins the
              right lists automatically.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
