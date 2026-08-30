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
  /**
   * Name-shaped words in the draft that match nobody on the roster, no site,
   * no shift type, and nothing the manager typed (BUG-058).
   *
   * A warning, never a verdict: English capitalises plenty of words that are
   * not names. A draft with an invented DATE never reaches here at all — the
   * Edge Function refuses it, because the composer pre-fills these fields and
   * a caution printed beside text already in the box is read after it is
   * posted.
   */
  unverified?: string[];
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
 * A refusal the person asking can do something about (HARDEN-004).
 *
 * The cost ceilings each have an answer that is not "try again later": shorten
 * the request, narrow the period, wait for the hour to roll over. So their
 * messages are written server-side, where the actual limit is known, and shown
 * verbatim. Collapsing them into "unavailable right now" would hide the one
 * piece of information that resolves them.
 */
export class AssistantRefusedError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'AssistantRefusedError';
    this.code = code;
  }
}

/** Statuses whose body carries a message worth showing the person who asked. */
const EXPLAINED_STATUSES = new Set([400, 403, 413, 429]);

/**
 * Invoke the assistant, turning an explained refusal into a typed error.
 *
 * `supabase.functions.invoke` reports a non-2xx as a `FunctionsHttpError`
 * whose `message` is generic — the body has to be read off `context`, which is
 * the raw `Response`. Without this the messages the Edge Function carefully
 * writes never reach the user.
 */
async function invokeAssistant<T>(body: Record<string, unknown>): Promise<T> {
  const result = await supabase.functions.invoke<T>('ai-rota-assistant', { body });

  if (result.error) {
    const context = (result.error as { context?: unknown }).context;
    if (context instanceof Response && EXPLAINED_STATUSES.has(context.status)) {
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
        if (payload.code && payload.error) {
          throw new AssistantRefusedError(payload.error, payload.code);
        }
      } catch (err) {
        // A typed error from the block above is the intended outcome and must
        // pass through. Anything else means the body was not the JSON we
        // expected — fall through to the original error, which is more
        // truthful than inventing a reason.
        if (err instanceof PlanRequiredError) throw err;
        if (err instanceof AssistantRefusedError) throw err;
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
