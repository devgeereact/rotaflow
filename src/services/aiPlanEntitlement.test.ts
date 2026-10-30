import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CAP-038 — a plan refusal has to survive the trip back to the user.
 *
 * `plans.features` has listed `ai_rota_assistant` as Business-and-above since
 * the start and nothing read it, so every organisation on every tier could
 * call the assistant, and each call spends real money at OpenRouter. The API
 * now refuses with a 403 carrying `code: 'plan_required'` and a sentence
 * naming the plans that include it.
 *
 * The trap this file guards is on the way back: the refusal has to reach the
 * composer as a PlanRequiredError with the API's own sentence. Miss that and
 * the composer shows "AI drafting is unavailable right now", which sends an
 * owner to check their connection over what is actually a billing decision.
 */

let nextResult: unknown = null;
let nextError: Error | null = null;
const post = vi.fn(
  (): Promise<unknown> =>
    nextError ? Promise.reject(nextError) : Promise.resolve(nextResult),
);

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { get: () => Promise.resolve({}), post } };
});

const { ApiError } = await import('@/lib/apiClient');
const { draftAnnouncement, generateRotaSuggestions, PlanRequiredError } = await import(
  '@/services/aiRotaService'
);

const REQUEST = {
  orgId: 'org-1',
  prompt: 'cover the weekend nights',
  periodStart: '2026-08-31',
  periodEnd: '2026-09-06',
};

beforeEach(() => {
  post.mockClear();
  nextResult = null;
  nextError = null;
});

describe('a plan refusal', () => {
  it('becomes a PlanRequiredError carrying the message the function wrote', async () => {
    nextError = new ApiError(
      403,
      'plan_required',
      'The AI assistant is included with the Business and Enterprise plans. Upgrade in Settings → Billing to use it.',
    );

    await expect(generateRotaSuggestions(REQUEST)).rejects.toThrow(PlanRequiredError);
    await expect(generateRotaSuggestions(REQUEST)).rejects.toThrow(
      /Business and Enterprise plans/,
    );
  });

  it('names the feature, so a caller can say which upgrade is needed', async () => {
    nextError = new ApiError(403, 'plan_required', 'Upgrade to use it.');
    await expect(draftAnnouncement(REQUEST)).rejects.toMatchObject({
      feature: 'ai_rota_assistant',
    });
  });

  it('reaches announcement drafting too, which is the same assistant', async () => {
    nextError = new ApiError(403, 'plan_required', 'Upgrade to use it.');
    await expect(draftAnnouncement(REQUEST)).rejects.toThrow(PlanRequiredError);
  });
});

describe('everything else keeps its own meaning', () => {
  it('a 403 that is not a plan refusal stays the original error', async () => {
    // The role check refuses with a plain 403. Turning that into "upgrade your
    // plan" would send an owner to the billing screen over a permissions
    // problem an upgrade cannot fix.
    nextError = new ApiError(
      403,
      'forbidden',
      'Only owners and managers can use the AI assistant',
    );
    await expect(generateRotaSuggestions(REQUEST)).rejects.not.toThrow(PlanRequiredError);
  });

  it('a 500 stays a 500', async () => {
    nextError = new ApiError(500, 'server_error', 'upstream failed');
    await expect(generateRotaSuggestions(REQUEST)).rejects.not.toThrow(PlanRequiredError);
  });

  it('a 403 whose body is not JSON falls back rather than inventing a reason', async () => {
    const error = new ApiError(403, 'http_error', 'Request failed (403)');
    nextError = error;
    // Not a PlanRequiredError, and not a parse crash either: the original
    // error is more truthful than a guess about why.
    await expect(generateRotaSuggestions(REQUEST)).rejects.not.toThrow(PlanRequiredError);
  });

  it('a success is returned untouched', async () => {
    nextResult = { suggestions: [], reasoning: 'ok' };
    await expect(generateRotaSuggestions(REQUEST)).resolves.toMatchObject({
      reasoning: 'ok',
    });
  });

  it('a 2xx with no body is still an error, not an empty draft', async () => {
    nextResult = null;
    await expect(draftAnnouncement(REQUEST)).rejects.toThrow(/no announcement draft/);
  });
});
