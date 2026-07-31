import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Megaphone, Plus, Trash2 } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
} from '@/services/announcementService';
import { listOrgMemberUserIds } from '@/services/orgService';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import type { Announcement } from '@/types';

/**
 * `/app/announcements` — composer (owner/manager) + feed (everyone).
 *
 * Scoped to org-wide announcements only. `announcements.scope` also supports
 * 'location'/'department' targeting in the schema, but there is no UI for
 * picking one here yet — org-wide covers the common case honestly; adding a
 * location/department picker without testing the RLS/query interaction
 * properly would be worse than leaving it for a follow-up.
 */
export function AnnouncementsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff } = usePermissions();
  const { user } = useSupabaseAuth();
  const { send } = useInngestDispatch();
  const { showError, showSuccess } = useToast();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['announcements'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const rows = await listAnnouncements(orgId);
        if (!active) return;
        setAnnouncements(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'announcements:load' });
        setLoadFailed(true);
        showError('Could not load announcements.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey, showError]);

  const handlePost = useCallback(async (): Promise<void> => {
    if (!orgId || !user || !title.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      const created = await createAnnouncement({
        org_id: orgId,
        author_user_id: user.id,
        title: title.trim(),
        body: body.trim(),
        urgent,
        scope: 'org',
      });
      setAnnouncements((prev) => [created, ...prev]);
      setTitle('');
      setBody('');
      setUrgent(false);
      showSuccess('Announcement posted.');

      // Fire-and-forget: a failed dispatch does not undo the post, which is
      // already visible in the feed above. See send-notification's header for
      // why this goes through Inngest rather than a direct client insert.
      const recipients = await listOrgMemberUserIds(orgId, user.id);
      if (recipients.length > 0) {
        void send('announcement/published', {
          orgId,
          userIds: recipients,
          type: 'announcement',
          title: created.title,
          body: created.body,
        });
      }
    } catch (err) {
      reportError(err, { area: 'announcements:create' });
      showError('Could not post that announcement. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [orgId, user, title, body, urgent, send, showError, showSuccess]);

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        await deleteAnnouncement(id);
        setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      } catch (err) {
        reportError(err, { area: 'announcements:delete' });
        showError('Could not remove that announcement.');
      }
    },
    [showError],
  );

  if (loadFailed && !loading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load announcements.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 font-display text-2xl text-content dark:text-content-dark">
        Announcements
      </h1>

      {canManageStaff && (
        <Card className="mb-6">
          <h2 className="mb-4 font-medium text-content dark:text-content-dark">
            Post an announcement
          </h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ann-title">Title</Label>
              <Input
                id="ann-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Staff meeting this Friday"
              />
            </div>
            <div>
              <Label htmlFor="ann-body">Message</Label>
              <textarea
                id="ann-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
                placeholder="Details for your team…"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
              <input
                type="checkbox"
                checked={urgent}
                onChange={(e) => setUrgent(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Mark as urgent
            </label>
            <Button
              size="sm"
              onClick={() => void handlePost()}
              disabled={submitting || !title.trim() || !body.trim()}
            >
              <Plus size={14} aria-hidden="true" className="mr-1.5" />
              {submitting ? 'Posting…' : 'Post announcement'}
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        </Card>
      ) : announcements.length === 0 ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">
            No announcements yet.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <Card
              key={announcement.id}
              className={cn(announcement.urgent && 'border-danger/40 bg-danger/5')}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {announcement.urgent ? (
                    <AlertTriangle size={16} aria-hidden="true" className="text-danger" />
                  ) : (
                    <Megaphone size={16} aria-hidden="true" className="text-primary" />
                  )}
                  <h3 className="font-medium text-content dark:text-content-dark">
                    {announcement.title}
                  </h3>
                </div>
                {canManageStaff && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(announcement.id)}
                    aria-label="Remove this announcement"
                    className="rounded p-1 text-content-muted hover:text-danger dark:text-content-muted-dark"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm text-content dark:text-content-dark">
                {announcement.body}
              </p>
              {announcement.published_at && (
                <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
                  {formatDistanceToNow(new Date(announcement.published_at), {
                    addSuffix: true,
                  })}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
