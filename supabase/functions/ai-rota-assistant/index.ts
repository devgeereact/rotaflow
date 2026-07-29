// AI rota assistant — RotaFlow
//
// Turns a manager's natural-language staffing request into shift suggestions,
// grounded in the org's real staff/skills/existing-shift data. Runs as the
// calling user (their JWT is forwarded into the Supabase client below), so
// Postgres RLS — not a service-role bypass — is what scopes every query to
// their org. Only OPENROUTER_API_KEY needs to stay server-side.
//
// Deploy: mcp Supabase `deploy_edge_function`, or `supabase functions deploy
// ai-rota-assistant`. Secret: `supabase secrets set OPENROUTER_API_KEY=...`.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  orgId: string;
  prompt: string;
  periodStart: string; // 'YYYY-MM-DD'
  periodEnd: string; // 'YYYY-MM-DD'
}

interface RawSuggestion {
  staffProfileId?: string;
  shiftTypeId?: string | null;
  date?: string;
  startTime?: string;
  endTime?: string;
  reasoning?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const raw = fenced ? fenced[1] : content;
  return JSON.parse(raw);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const body = (await req.json()) as Partial<RequestBody>;
    const { orgId, prompt, periodStart, periodEnd } = body;
    if (!orgId || !prompt || !periodStart || !periodEnd) {
      return jsonResponse(
        { error: 'orgId, prompt, periodStart and periodEnd are required' },
        400,
      );
    }

    const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openRouterKey) {
      return jsonResponse({ error: 'AI assistant is not configured yet' }, 503);
    }

    // Scoped as the calling user — RLS enforces org membership on every query.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: canManage, error: roleError } = await supabase.rpc('has_org_role', {
      p_org: orgId,
      p_roles: ['owner', 'manager'],
    });
    if (roleError) throw roleError;
    if (!canManage) {
      return jsonResponse(
        { error: 'Only owners and managers can request rota suggestions' },
        403,
      );
    }

    const [{ data: org }, { data: staff }, { data: shiftTypes }, { data: existingShifts }, { data: leave }] =
      await Promise.all([
        supabase.from('organisations').select('name').eq('id', orgId).single(),
        supabase
          .from('staff_profiles')
          .select('id, first_name, last_name, job_title, skills, weekly_hours, contract_type')
          .eq('org_id', orgId)
          .eq('active', true),
        supabase.from('shift_types').select('id, name, default_start, default_end').eq('org_id', orgId),
        supabase
          .from('shifts')
          .select('staff_profile_id, starts_at, ends_at')
          .eq('org_id', orgId)
          .gte('starts_at', `${periodStart}T00:00:00Z`)
          .lte('starts_at', `${periodEnd}T23:59:59Z`),
        supabase
          .from('leave_requests')
          .select('staff_profile_id, start_date, end_date')
          .eq('org_id', orgId)
          .eq('status', 'approved')
          .lte('start_date', periodEnd)
          .gte('end_date', periodStart),
      ]);

    if (!staff || staff.length === 0) {
      return jsonResponse({
        summary:
          'No active staff are set up for this organisation yet, so no shifts can be suggested. Add staff profiles first.',
        suggestions: [],
      });
    }

    const staffById = new Map(staff.map((s) => [s.id, s]));
    const shiftTypeById = new Map((shiftTypes ?? []).map((t) => [t.id, t]));

    const context = {
      organisation: org?.name ?? 'this organisation',
      period: { start: periodStart, end: periodEnd },
      staff: staff.map((s) => ({
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        jobTitle: s.job_title,
        skills: s.skills,
        weeklyHours: s.weekly_hours,
        contractType: s.contract_type,
      })),
      shiftTypes: (shiftTypes ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        defaultStart: t.default_start,
        defaultEnd: t.default_end,
      })),
      existingShifts: (existingShifts ?? []).map((sh) => ({
        staffProfileId: sh.staff_profile_id,
        startsAt: sh.starts_at,
        endsAt: sh.ends_at,
      })),
      approvedLeave: (leave ?? []).map((l) => ({
        staffProfileId: l.staff_profile_id,
        startDate: l.start_date,
        endDate: l.end_date,
      })),
    };

    const systemPrompt = `You are RotaFlow's rota-drafting assistant for a workforce scheduling app. \
You suggest shifts for a manager based on real staff data. Never invent staff or shift types — only use \
the ids given in the context. Never schedule someone who has approved leave overlapping the shift date. \
Respond with ONLY a single JSON object (no markdown, no commentary outside the JSON) matching exactly:
{
  "summary": string, // one or two sentences explaining your approach
  "suggestions": [
    {
      "staffProfileId": string, // must be an id from context.staff
      "shiftTypeId": string | null, // an id from context.shiftTypes, or null
      "date": string, // "YYYY-MM-DD", within the given period
      "startTime": string, // "HH:MM", 24-hour
      "endTime": string, // "HH:MM", 24-hour
      "reasoning": string // short, one sentence
    }
  ]
}`;

    const userPrompt = `Context:\n${JSON.stringify(context, null, 2)}\n\nManager's request: "${prompt}"`;

    const model = Deno.env.get('OPENROUTER_MODEL') || 'openai/gpt-4o-mini';
    const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': Deno.env.get('APP_URL') || 'https://rotaflow.app',
        'X-Title': 'RotaFlow',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!openRouterRes.ok) {
      const errText = await openRouterRes.text();
      console.error('OpenRouter error', openRouterRes.status, errText);
      return jsonResponse({ error: 'The AI assistant is temporarily unavailable' }, 502);
    }

    const completion = await openRouterRes.json();
    const content: string | undefined = completion?.choices?.[0]?.message?.content;
    if (!content) {
      return jsonResponse({ error: 'The AI assistant returned an empty response' }, 502);
    }

    let parsed: { summary?: string; suggestions?: RawSuggestion[] };
    try {
      parsed = extractJson(content) as typeof parsed;
    } catch (err) {
      console.error('Failed to parse AI response', content, err);
      return jsonResponse({ error: 'The AI assistant returned an unreadable response' }, 502);
    }

    // Defensive: only trust suggestions referencing real staff/shift-type ids.
    const suggestions = (parsed.suggestions ?? [])
      .filter(
        (s): s is Required<Pick<RawSuggestion, 'staffProfileId' | 'date' | 'startTime' | 'endTime'>> &
          RawSuggestion =>
          !!s.staffProfileId &&
          staffById.has(s.staffProfileId) &&
          !!s.date &&
          !!s.startTime &&
          !!s.endTime,
      )
      .map((s) => {
        const staffMember = staffById.get(s.staffProfileId!)!;
        const shiftType = s.shiftTypeId ? shiftTypeById.get(s.shiftTypeId) : undefined;
        return {
          staffProfileId: s.staffProfileId!,
          staffName: `${staffMember.first_name} ${staffMember.last_name}`,
          shiftTypeId: shiftType ? s.shiftTypeId! : null,
          shiftTypeName: shiftType?.name ?? null,
          date: s.date!,
          startTime: s.startTime!,
          endTime: s.endTime!,
          reasoning: s.reasoning ?? '',
        };
      });

    return jsonResponse({
      summary: parsed.summary ?? '',
      suggestions,
    });
  } catch (err) {
    console.error('ai-rota-assistant error', err);
    return jsonResponse({ error: 'Unexpected error generating rota suggestions' }, 500);
  }
});
