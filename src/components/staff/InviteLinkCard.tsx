import { Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconTile } from '@/components/ui/IconTile';

interface InviteLinkCardProps {
  email: string;
  url: string;
  onCopy: () => void;
  onDismiss: () => void;
}

/**
 * The one and only sighting of a raw invitation token.
 *
 * RotaFlow stores a sha256 hash, never the token, so this URL cannot be
 * recovered after the card is dismissed — hence the emphasis and the fact
 * that it sits above the table rather than inside a toast that auto-hides.
 */
export function InviteLinkCard({
  email,
  url,
  onCopy,
  onDismiss,
}: InviteLinkCardProps): JSX.Element {
  return (
    <Card className="mb-5 border-primary/30 bg-primary/5 dark:bg-primary/10">
      <div className="flex items-start gap-3">
        <IconTile icon={KeyRound} tone="primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-content dark:text-content-dark">
            Invitation link for {email}
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
            Send this to them now. It is shown once — only a hash of the token is stored,
            so it cannot be retrieved again. Revoke and reissue if it is lost.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-surface-border bg-surface px-3.5 py-2 font-mono text-xs text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark">
              {url}
            </code>
            <Button size="sm" onClick={onCopy}>
              <Copy size={14} aria-hidden="true" />
              Copy link
            </Button>
            <Button size="sm" variant="secondary" onClick={onDismiss}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
