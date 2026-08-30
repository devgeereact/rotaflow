import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CAP-038 — a plan refusal has to survive the trip back to the user.
 *
 * `plans.features` has listed `ai_rota_assistant` as Business-and-above since
 * migration 0030 and nothing ever read it, so every organisation on every tier
 * could call the assistant — and each call spends real money at OpenRouter.
 * The Edge Function now refuses with a 403 carrying `code: 'plan_required'`
 * and a sentence naming the plans that include it.
 *
 * The trap this file guards is on the way back. `supabase.functions.invoke`
 * reports a non-2xx as a `FunctionsHttpError` whose `message` is generic; the
 * body lives on `context`, the raw `Response`, and has to be read off it
 * deliberately. Miss that and the composer shows "AI drafting is unavailable
 * right now" — which sends an owner to check their connection over what is
 * actually a billing decision, and is the one error here they could have acted
 * on.
 */

let invokeResult: { data: unknown; error: unknown } = { data: null, error: null };
const invoke = vi.fn(() => Promise.resolve(invokeResult));

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));

const { draftAnnouncement, generateRotaSuggestions, PlanRequiredError } =
  await import('@/services/aiRotaService');

/** A `FunctionsHttpError` as the SDK actually shapes one. */
function httpError(
  status: number,
  body: unknown,
): { message: string; context: Response } {
  return {
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  };
}

const REQUEST = {
  orgId: 'org-1',
  prompt: 'cover the weekend nights',
  periodStart: '2026-08-31',
  periodEnd: '2026-09-06',
};

beforeEach(() => {
  invoke.mockClear();
  invokeResult = { data: null, error: null };
});

describe('a plan refusal', () => {
  it('becomes a PlanRequiredError carrying the message the function wrote', async () => {
    invokeResult = {
      data: null,
      error: httpError(403, {
        error:
          'The AI assistant is included with the Business and Enterprise plans. Upgrade in Settings → Billing to use it.',
        code: 'plan_required',
        feature: 'ai_rota_assistant',
      }),
    };

    await expect(generateRotaSuggestions(REQUEST)).rejects.toThrow(PlanRequiredError);
    await expect(generateRotaSuggestions(REQUEST)).rejects.toThrow(
      /Business and Enterprise plans/,
    );
  });

  it('names the feature, so a caller can say which upgrade is needed', async () => {
    invokeResult = {
      data: null,
      error: httpError(403, { code: 'plan_required', feature: 'ai_rota_assistant' }),
    };
    await expect(draftAnnouncement(REQUEST)).rejects.toMatchObject({
      feature: 'ai_rota_assistant',
    });
  });

  it('reaches announcement drafting too — it is the same Edge Function', async () => {
    invokeResult = {
      data: null,
      error: httpError(403, { error: 'Upgrade to use it.', code: 'plan_required' }),
    };
    await expect(draftAnnouncement(REQUEST)).rejects.toThrow(PlanRequiredError);
  });
});

describe('everything else keeps its own meaning', () => {
  it('a 403 that is not a plan refusal stays the original error', async () => {
    // The role check refuses with a plain 403. Turning that into "upgrade your
    // plan" would send an owner to the billing screen over a permissions
    // problem an upgrade cannot fix.
    invokeResult = {
      data: null,
      error: httpError(403, {
        error: 'Only owners and managers can use the AI assistant',
      }),
    };
    await expect(generateRotaSuggestions(REQUEST)).rejects.not.toThrow(PlanRequiredError);
  });

  it('a 500 stays a 500', async () => {
    invokeResult = { data: null, error: httpError(500, { error: 'upstream failed' }) };
    await expect(generateRotaSuggestions(REQUEST)).rejects.not.toThrow(PlanRequiredError);
  });

  it('a 403 whose body is not JSON falls back rather than inventing a reason', async () => {
    const error = {
      message: 'Edge Function returned a non-2xx status code',
      context: new Response('<html>gateway</html>', { status: 403 }),
    };
    invokeResult = { data: null, error };
    // Not a PlanRequiredError, and not a parse crash either: the original
    // error is more truthful than a guess about why.
    await expect(generateRotaSuggestions(REQUEST)).rejects.toBe(error);
  });

  it('a success is returned untouched', async () => {
    invokeResult = { data: { suggestions: [], reasoning: 'ok' }, error: null };
    await expect(generateRotaSuggestions(REQUEST)).resolves.toMatchObject({
      reasoning: 'ok',
    });
  });

  it('a 2xx with no body is still an error, not an empty draft', async () => {
    invokeResult = { data: null, error: null };
    await expect(draftAnnouncement(REQUEST)).rejects.toThrow(/no announcement draft/);
  });
});
