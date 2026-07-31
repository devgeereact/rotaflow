import { FileText } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { DocumentStatus, StaffDocument } from '@/lib/staffDirectory';

interface DocumentListProps {
  documents: StaffDocument[];
}

const TONES: Record<DocumentStatus, BadgeTone> = {
  valid: 'success',
  expiring: 'warning',
  expired: 'danger',
};

const LABELS: Record<DocumentStatus, string> = {
  valid: 'Valid',
  expiring: 'Expiring soon',
  expired: 'Expired',
};

/** Compliance documents with their expiry state — the panel and profile rail share this. */
export function DocumentList({ documents }: DocumentListProps): JSX.Element {
  return (
    <ul className="space-y-3.5">
      {documents.map((doc) => (
        <li key={doc.id} className="flex items-start gap-2.5">
          <FileText
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-content-muted dark:text-content-muted-dark"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
              {doc.name}
            </p>
            <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
              {doc.expiresLabel}
            </p>
          </div>
          <Badge tone={TONES[doc.status]} className="shrink-0">
            {LABELS[doc.status]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
