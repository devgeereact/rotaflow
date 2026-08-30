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
 * The organisation's plan does not include the AI assistant.
 *
 * Distinguished from every other failure because the answer is different: a
 * transient error means "try again", this means "upgrade, or stop asking". A
 * screen that shows "unavailable right now" for a plan refusal sends an owner
 * to check their connection over a billing decision.
 */
export class PlanRequiredError extends Error {
  readonly feature: string;
  constructor(message: string, feature: string) {
    super(message);
    this.name = 'PlanRequiredError';
    this.feature = feature;
  }
}

/**
 * Invoke the assistant, turning a 403 plan refusal into `PlanRequiredError`.
 *
 * `supabase.functions.invoke` reports a non-2xx as a `FunctionsHttpError`
 * whose `message` is generic — the body has to be read off `context`, which is
 * the raw `Response`. Without this the entitlement message the Edge Function
 * carefully writes never reaches the user.
 */
async function invokeAssistant<T>(body: Record<string, unknown>): Promise<T> {
  const result = await supabase.functions.invoke<T>('ai-rota-assistant', { body });

  if (result.error) {
    const context = (result.error as { context?: unknown }).context;
    if (context instanceof Response && context.status === 403) {
      try {
        // `clone()`, because the SDK may already have consumed the body and a
        // Response can only be read once.
        const payload = (await context.clone().json()) as {
          code?: string;
          error?: string;
          feature?: string;
        };
        if (payload.code === 'plan_required') {
          throw new PlanRequiredError(
            payload.error ?? 'This feature is not included in your plan.',
            payload.feature ?? 'ai_rota_assistant',
          );
        }
      } catch (err) {
        // A PlanRequiredError from the block above is the intended outcome and
        // must pass through. Anything else means the body was not the JSON we
        // expected — fall through to the original error, which is more
        // truthful than inventing a reason.
        if (err instanceof PlanRequiredError) throw err;
      }
    }
    throw result.error;
  }
  return result.data as T;
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
  const data = await invokeAssistant<AiRotaResponse>({ ...request, task: 'rota' });
  if (!data) throw new Error('AI rota assistant returned no data');
  return data;
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
  const data = await invokeAssistant<AiAnnouncementDraft>({
    ...request,
    task: 'announcement',
  });
  if (!data) throw new Error('AI assistant returned no announcement draft');
  return data;
}
