import { supabase } from '@/lib/supabase';

export interface AiRotaRequest {
  orgId: string;
  prompt: string;
  periodStart: string; // date, 'YYYY-MM-DD'
  periodEnd: string; // date, 'YYYY-MM-DD'
}

/** Same grounding inputs as a rota request. The Edge Function branches on `task`. */
export type AiAnnouncementRequest = AiRotaRequest;

export interface AiAnnouncementDraft {
  title: string;
  body: string;
  urgent: boolean;
  /** Which facts the model drew on. Shown so the manager can sanity-check it. */
  reasoning: string;
}

export interface AiShiftSuggestion {
  staffProfileId: string;
  staffName: string;
  shiftTypeId: string | null;
  shiftTypeName: string | null;
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  endTime: string; // 'HH:MM'
  reasoning: string;
}

export interface AiRotaResponse {
  summary: string;
  suggestions: AiShiftSuggestion[];
}

/**
 * Ask the AI rota assistant (Supabase Edge Function → OpenRouter) to draft
 * shift suggestions from a natural-language prompt, grounded in the org's
 * real staff, skills and existing shifts. Returns suggestions only. Nothing
 * is written until the manager applies them via `shiftService.createShifts`.
 */
export async function generateRotaSuggestions(
  request: AiRotaRequest,
): Promise<AiRotaResponse> {
  const result = await supabase.functions.invoke<AiRotaResponse>('ai-rota-assistant', {
    body: { ...request, task: 'rota' },
  });

  if (result.error) throw result.error;
  if (!result.data) throw new Error('AI rota assistant returned no data');
  return result.data;
}

/**
 * Ask the same Edge Function to draft a staff announcement grounded in the
 * period's real rota. Open shifts, approved leave, who is on. Returns a
 * draft only; nothing is published until the manager posts it from the
 * composer, so a bad draft costs an edit, never a notification to the team.
 */
export async function draftAnnouncement(
  request: AiAnnouncementRequest,
): Promise<AiAnnouncementDraft> {
  const result = await supabase.functions.invoke<AiAnnouncementDraft>(
    'ai-rota-assistant',
    { body: { ...request, task: 'announcement' } },
  );

  if (result.error) throw result.error;
  if (!result.data) throw new Error('AI assistant returned no announcement draft');
  return result.data;
}
