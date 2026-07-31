import { cn } from '@/lib/utils';

interface SkillChipListProps {
  skills: string[];
  /** `primary` is the table/profile blue wash; `neutral` is the details panel. */
  tone?: 'primary' | 'neutral';
  /**
   * Roughly how much label text fits on one line before the rest collapse into
   * a `+N` chip. Character count stands in for measured width — the reference's
   * table row fits about 30 characters of chips. Omit to show all.
   */
  maxChars?: number;
  className?: string;
}

const CHIP =
  'inline-flex items-center whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium';

const TONES = {
  primary: 'bg-primary/[0.07] text-primary',
  neutral: 'bg-divider text-content dark:bg-surface-subtle-dark dark:text-content-dark',
} as const;

/** Always keeps at least one chip, even when its own label busts the budget. */
function fitSkills(skills: string[], budget: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const skill of skills) {
    if (kept.length > 0 && used + skill.length > budget) break;
    kept.push(skill);
    used += skill.length;
  }
  return kept;
}

/** Skill tags for a staff row, panel or profile rail (design/staff.png). */
export function SkillChipList({
  skills,
  tone = 'primary',
  maxChars,
  className,
}: SkillChipListProps): JSX.Element {
  const shown = maxChars === undefined ? skills : fitSkills(skills, maxChars);
  const overflow = skills.length - shown.length;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {shown.map((skill) => (
        <span key={skill} className={cn(CHIP, TONES[tone])}>
          {skill}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            CHIP,
            'border border-primary/25 bg-surface text-primary dark:bg-surface-dark',
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
