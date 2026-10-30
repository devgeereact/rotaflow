import { activeOrgPath, api, seg } from '@/lib/api';
import type { SchedulingWarning } from '@/lib/schedulingRules';

/**
 * Scheduling tools (R2 slice S11): the publish preview and recurring patterns. (The shifts that
 * clash with a leave approval come back from `reviewLeaveWithClashes` in leaveService.) Every screen that uses this stays behind the `scheduling_tools`
 * feature flag (useFeatureAccess), and the server refuses these routes (403 feature_off) while
 * the flag is off, so the module ships dark.
 */
export const SCHEDULING_TOOLS_FEATURE = 'scheduling_tools';

export interface PreviewShift {
  id: string;
  staff_profile_id: string | null;
  location_id: string | null;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  status: string;
}

export interface PublishPreview {
  rota: {
    id: string;
    name: string;
    period_start: string;
    period_end: string;
    supersedes_rota_id: string | null;
  };
  limits: { min_rest_hours: number; max_weekly_hours: number };
  shifts: (PreviewShift & {
    change: 'new' | 'unchanged' | 'cancelled';
    warnings: SchedulingWarning[];
  })[];
  removed: PreviewShift[];
  total: number;
  truncated: boolean;
  counts: { new: number; unchanged: number; cancelled: number; removed: number };
  with_warnings: number;
  warnings_by_code: Record<string, number>;
  overlaps: {
    staff_profile_id: string;
    shift: PreviewShift;
    other: PreviewShift & { rota_id: string | null };
  }[];
  can_publish: boolean;
}

export async function getPublishPreview(rotaId: string): Promise<PublishPreview> {
  return api.get<PublishPreview>(activeOrgPath(`/rotas/${seg(rotaId)}/publish-preview`));
}

export interface GenerateResult {
  created: number;
  shift_ids: string[];
  skipped: {
    date: string;
    starts_at: string;
    ends_at: string;
    reason: string;
    message: string;
  }[];
  warnings: { starts_at: string; ends_at: string; warnings: SchedulingWarning[] }[];
  preview: boolean;
}

/** `body` comes from `patternBody` in `src/lib/schedulingRules.ts`. */
export async function generatePattern(
  rotaId: string,
  body: Record<string, unknown>,
): Promise<GenerateResult> {
  return api.post<GenerateResult>(
    activeOrgPath(`/rotas/${seg(rotaId)}/patterns/generate`),
    body,
  );
}
