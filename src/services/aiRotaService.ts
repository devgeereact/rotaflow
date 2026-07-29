import { supabase } from '@/lib/supabase';

export interface AiRotaRequest {
  orgId: string;
  prompt: string;
  periodStart: string; // date, 'YYYY-MM-DD'
  periodEnd: string; // date, 'YYYY-MM-DD'
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
 * real staff, skills and existing shifts. Returns suggestions only — nothing
 * is written until the manager applies them via `shiftService.createShifts`.
 */
export async function generateRotaSuggestions(
  request: AiRotaRequest,
): Promise<AiRotaResponse> {
  const result = await supabase.functions.invoke<AiRotaResponse>('ai-rota-assistant', {
    body: request,
  });

  if (result.error) throw result.error;
  if (!result.data) throw new Error('AI rota assistant returned no data');
  return result.data;
}
