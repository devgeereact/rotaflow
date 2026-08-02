// AI rota assistant — RotaFlow
//
// Two tasks, one function, because both need the same grounding query and the
// same RLS-scoped client:
//
//   task: 'rota'         — turn a staffing request into shift suggestions
//   task: 'announcement' — draft an announcement about what is actually
//                          happening on the rota this period
//
// Runs as the calling user (their JWT is forwarded into the Supabase client
// below), so Postgres RLS — not a service-role bypass — is what scopes every
// query to their org. Only OPENROUTER_API_KEY needs to stay server-side.
//
// WHAT THIS FUNCTION IS NOT: the decision-maker. Coverage gaps, leave clashes,
// rest breaches and who-can-cover are computed deterministically on the client
// in `src/lib/rotaInsights.ts`, and they work with no API key at all. This
// function reads the same facts and writes prose about them. Keeping the
// judgement out of the model is what stops a demo — or a manager — acting on a
// confidently invented name, date or shortage.
//
// Deploy: `supabase functions deploy ai-rota-assistant`.
// Secret: `supabase secrets set OPENROUTER_API_KEY=...`.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Task = 'rota' | 'announcement';

interface RequestBody {
  orgId: string;
  prompt: string;
  periodStart: string; // 'YYYY-MM-DD'
  periodEnd: string; // 'YYYY-MM-DD'
  task?: Task;
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

const ROTA_SYSTEM_PROMPT = `You are RotaFlow's rota-drafting assistant for a workforce scheduling app. \
You suggest shifts for a manager based on real staff data. Never invent staff or shift types — only use \
the ids given in the context.

Hard rules, in priority order. Breaking one makes the whole suggestion useless:
1. Never schedule someone whose id appears in context.approvedLeave for a date inside that leave.
2. Never schedule someone on a date they are listed as unavailable for in context.unavailability \
(recurring rows give a weekday where 0 = Sunday; one-off rows give a date).
3. Never create a shift that overlaps one the person already has in context.existingShifts.
4. Leave at least 11 hours between the end of one shift and the start of that person's next \
(the Working Time Regulations rest period).
5. Prefer people whose scheduledHours are below their weeklyHours, and prefer zero-hours staff \
(weeklyHours 0) for extra cover over pushing a contracted person into overtime.
6. Prefer people who already work the same shiftTypeId at the same location — they know the pattern.

Respond with ONLY a single JSON object (no markdown, no commentary outside the JSON) matching exactly:
{
  "summary": string, // one or two sentences on your approach and any rule that constrained you
  "suggestions": [
    {
      "staffProfileId": string, // must be an id from context.staff
      "shiftTypeId": string | null, // an id from context.shiftTypes, or null
      "date": string, // "YYYY-MM-DD", within the given period
      "startTime": string, // "HH:MM", 24-hour
      "endTime": string, // "HH:MM", 24-hour
      "reasoning": string // short, one sentence, naming the rule that made this a good fit
    }
  ]
}`;

const ANNOUNCEMENT_SYSTEM_PROMPT = `You are RotaFlow's communications assistant. You draft a single \
staff announcement for a manager, grounded in what is genuinely happening on their rota.

Rules:
- Use only facts present in the context. Never invent a date, a name, a site or a number.
- Write in British English, plain and warm, addressed to the whole team. No corporate padding.
- Two to four sentences in the body. Say what is happening, what the team needs to do, and by when.
- Set "urgent" true only for genuine time-critical safety or cover matters, never for routine notices.
- If the manager's request is not supported by the context, say so plainly in the body rather than \
inventing detail to fill it.

Respond with ONLY a single JSON object (no markdown, no commentary outside the JSON) matching exactly:
{
  "title": string, // under 80 characters, no trailing full stop
  "body": string,
  "urgent": boolean,
  "reasoning": string // one sentence on which facts you drew on
}`;

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
    const task: Task = body.task === 'announcement' ? 'announcement' : 'rota';
    if (!orgId || !prompt || !periodStart || !periodEnd) {
      return jsonResponse(
        { error: 'orgId, prompt, periodStart and periodEnd are required' },
        400,
      );
    }

    const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openRouterKey) {
      // A specific, actionable message: this is a missing secret, not an
      // outage, and the client surfaces it verbatim so nobody debugs the
      // network looking for a problem that is one `secrets set` away.
      return jsonResponse(
        {
          error:
            'AI drafting is not configured — OPENROUTER_API_KEY has not been set on this project.',
        },
        503,
      );
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
        { error: 'Only owners and managers can use the AI assistant' },
        403,
      );
    }

    const [
      { data: org },
      { data: staff },
      { data: shiftTypes },
      { data: existingShifts },
      { data: leave },
      { data: availability },
      { data: locations },
    ] = await Promise.all([
      supabase.from('organisations').select('name').eq('id', orgId).single(),
      supabase
        .from('staff_profiles')
        .select(
          'id, first_name, last_name, job_title, skills, weekly_hours, contract_type',
        )
        .eq('org_id', orgId)
        .eq('active', true),
      supabase
        .from('shift_types')
        .select('id, name, default_start, default_end')
        .eq('org_id', orgId),
      supabase
        .from('shifts')
        .select(
          'id, staff_profile_id, shift_type_id, location_id, starts_at, ends_at, break_minutes, status',
        )
        .eq('org_id', orgId)
        .gte('starts_at', `${periodStart}T00:00:00Z`)
        .lte('starts_at', `${periodEnd}T23:59:59Z`),
      supabase
        .from('leave_requests')
        .select('staff_profile_id, start_date, end_date, type')
        .eq('org_id', orgId)
        .eq('status', 'approved')
        .lte('start_date', periodEnd)
        .gte('end_date', periodStart),
      // Declared unavailability. Recurring rows carry a weekday (0 = Sunday);
      // one-off rows carry a date. Both block a suggestion, so both go in.
      supabase
        .from('availability')
        .select('staff_profile_id, weekday, date, status, recurring')
        .eq('org_id', orgId)
        .eq('status', 'unavailable'),
      supabase.from('locations').select('id, name').eq('org_id', orgId),
    ]);

    if (!staff || staff.length === 0) {
      return jsonResponse({
        summary:
          'No active staff are set up for this organisation yet, so nothing can be suggested. Add staff profiles first.',
        suggestions: [],
      });
    }

    const staffById = new Map(staff.map((s) => [s.id, s]));
    const shiftTypeById = new Map((shiftTypes ?? []).map((t) => [t.id, t]));
    const locationNameById = new Map((locations ?? []).map((l) => [l.id, l.name]));
    const shifts = existingShifts ?? [];

    // Hours already scheduled per person this period, so the model can see who
    // has headroom instead of inferring it from contract type alone.
    const scheduledHours = new Map<string, number>();
    for (const shift of shifts) {
      if (!shift.staff_profile_id) continue;
      const minutes =
        (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) /
          60_000 -
        (shift.break_minutes ?? 0);
      scheduledHours.set(
        shift.staff_profile_id,
        (scheduledHours.get(shift.staff_profile_id) ?? 0) + Math.max(0, minutes) / 60,
      );
    }

    const openShifts = shifts.filter(
      (s) => !s.staff_profile_id && s.status !== 'cancelled',
    );

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
        scheduledHours: Number((scheduledHours.get(s.id) ?? 0).toFixed(1)),
      })),
      shiftTypes: (shiftTypes ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        defaultStart: t.default_start,
        defaultEnd: t.default_end,
      })),
      locations: (locations ?? []).map((l) => ({ id: l.id, name: l.name })),
      existingShifts: shifts
        .filter((s) => s.staff_profile_id)
        .map((s) => ({
          staffProfileId: s.staff_profile_id,
          shiftTypeId: s.shift_type_id,
          locationId: s.location_id,
          startsAt: s.starts_at,
          endsAt: s.ends_at,
        })),
      openShifts: openShifts.map((s) => ({
        shiftTypeId: s.shift_type_id,
        shiftTypeName: s.shift_type_id ? shiftTypeById.get(s.shift_type_id)?.name : null,
        location: s.location_id ? locationNameById.get(s.location_id) : null,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
      })),
      approvedLeave: (leave ?? []).map((l) => ({
        staffProfileId: l.staff_profile_id,
        startDate: l.start_date,
        endDate: l.end_date,
        type: l.type,
      })),
      unavailability: (availability ?? []).map((a) => ({
        staffProfileId: a.staff_profile_id,
        weekday: a.recurring ? a.weekday : null, // 0 = Sunday
        date: a.date,
      })),
    };

    const systemPrompt =
      task === 'announcement' ? ANNOUNCEMENT_SYSTEM_PROMPT : ROTA_SYSTEM_PROMPT;
    const userPrompt = `Context:\n${JSON.stringify(context, null, 2)}\n\nManager's request: "${prompt}"`;

    const model = Deno.env.get('OPENROUTER_MODEL') || 'openai/gpt-4o-mini';
    const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': Deno.env.get('APP_URL') || 'https://rota.gakinz.com',
        'X-Title': 'RotaFlow',
      },
      body: JSON.stringify({
        model,
        temperature: task === 'announcement' ? 0.5 : 0.3,
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

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson(content) as Record<string, unknown>;
    } catch (err) {
      console.error('Failed to parse AI response', content, err);
      return jsonResponse(
        { error: 'The AI assistant returned an unreadable response' },
        502,
      );
    }

    if (task === 'announcement') {
      const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
      const draftBody = typeof parsed.body === 'string' ? parsed.body.trim() : '';
      if (!title || !draftBody) {
        return jsonResponse(
          { error: 'The AI assistant returned an announcement with no title or body' },
          502,
        );
      }
      return jsonResponse({
        title: title.slice(0, 120),
        body: draftBody,
        urgent: parsed.urgent === true,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      });
    }

    // Defensive: only trust suggestions referencing real staff/shift-type ids.
    // The model is told the rules, but "told" is not "verified" — an id that
    // does not exist would fail at insert time with a foreign-key error the
    // manager cannot act on, so it is dropped here instead.
    const suggestions = ((parsed.suggestions as RawSuggestion[] | undefined) ?? [])
      .filter(
        (
          s,
        ): s is Required<
          Pick<RawSuggestion, 'staffProfileId' | 'date' | 'startTime' | 'endTime'>
        > &
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
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      suggestions,
    });
  } catch (err) {
    console.error('ai-rota-assistant error', err);
    return jsonResponse({ error: 'Unexpected error generating suggestions' }, 500);
  }
});
