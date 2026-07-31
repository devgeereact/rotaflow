import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import type { StaffSkill } from '@/lib/staffProfile';

interface SkillsCompetenciesCardProps {
  skills: StaffSkill[];
  onViewAll: () => void;
}

/** Skill chips paired with a competency level (design/Staff-Profile.png). */
export function SkillsCompetenciesCard({
  skills,
  onViewAll,
}: SkillsCompetenciesCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <StaffSectionHeader
        title="Skills & Competencies"
        action={<StaffLinkButton onClick={onViewAll}>View all</StaffLinkButton>}
      />
      <ul className="mt-3.5 space-y-2.5">
        {skills.map((skill) => (
          <li key={skill.name} className="flex items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center rounded-md bg-primary/[0.07] px-2 py-1 text-xs font-semibold text-primary">
              <span className="truncate">{skill.name}</span>
            </span>
            {skill.level && (
              <Badge tone="success" className="shrink-0">
                {skill.level}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
