import { Card } from '@/components/ui/Card';
import { DocumentList } from '@/components/staff/DocumentList';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import type { StaffDocument } from '@/lib/staffDirectory';

interface DocumentsCardProps {
  documents: StaffDocument[];
  onViewAll: () => void;
}

/** Compliance documents in the profile rail (docs/design/Staff-Profile.png). */
export function DocumentsCard({ documents, onViewAll }: DocumentsCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <StaffSectionHeader
        title="Documents"
        action={<StaffLinkButton onClick={onViewAll}>View all</StaffLinkButton>}
      />
      <div className="mt-3.5">
        <DocumentList documents={documents} />
      </div>
    </Card>
  );
}
