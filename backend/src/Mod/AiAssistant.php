<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{AiGrounding, AiStaffAliases, Audit, Billing as BillingState, Ctx, Flags, HttpError, Input, Module, Scope, Str, Time};

/**
 * The AI rota assistant (the PHP form of the ai-rota-assistant Edge Function). Two tasks share one grounding query:
 *
 *   POST /orgs/{o}/ai/rota          turn a staffing request into shift suggestions
 *   POST /orgs/{o}/ai/announcement  draft an announcement about what is actually happening on the rota this period
 *
 * WHAT THIS IS NOT: the decision-maker. Coverage gaps, leave clashes and rest breaches are computed deterministically in the app and
 * work with no key at all. This reads the same facts and writes prose about them; every suggestion is checked here before it is returned.
 *
 * Who may call, in this order, each refusal made before any outside call is attempted:
 *   1. an owner or manager of the organisation (effective role, so lent authority counts), never a support session: a support session
 *      must not spend a customer's AI budget or send their staff data to a model provider. Anyone else is 404 (not a member) or 403.
 *   2. the organisation's plan includes `ai_rota_assistant` (Billing::hasFeature; false while read-only). 403 plan_required.
 *   3. the `ai_rota_assistant` feature flag is on for the organisation (the platform's kill switch). 403 feature_off.
 *   4. the server holds an OpenRouter key. 503 ai_unavailable.
 *   5. 30 requests an hour for the person and 200 an hour for the organisation. 429 rate_limited.
 * Every one of them fails CLOSED: an error resolving a plan or a flag refuses.
 *
 * Staff are sent to the model as S1, S2... with no names (AiStaffAliases); approved leave is sent as dates only, never its type (sick
 * leave is special-category health data); the manager's own prompt has names masked. The model's reply is never returned as is:
 * ids are matched to real rows, times snapped to the shift type's own hours, overlaps and leave/unavailable days dropped, and an
 * announcement is refused if it states a date that is in neither the period nor the manager's own words (AiGrounding).
 *
 * Private config (names only): openrouter_api_key, openrouter_model (default openai/gpt-4o-mini), openrouter_fallback_model (optional;
 * a second model on a different provider that OpenRouter routes to inside the same request). The key and the model's raw reply are
 * never logged and never returned. Nothing is stored except one audit row per completed request (counts and lengths, no text).
 */
final class AiAssistant implements Module
{
    private const FEATURE = 'ai_rota_assistant';
    private const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
    private const DEFAULT_MODEL = 'openai/gpt-4o-mini';
    /** Bump on any wording change to either prompt: it is carried into every audit row so a suggestion traces to the prompt that made it. 2: staff are aliases. */
    private const PROMPT_VERSION = 2;
    /** The manager's own words. Long enough for a detailed brief, not an essay. */
    private const MAX_PROMPT_CHARS = 2000;
    /** The serialised context: ~30k tokens. Over it the person is told to narrow the period; part of the roster is never silently dropped. */
    private const MAX_CONTEXT_CHARS = 120000;
    private const USER_PER_HOUR = 30;
    private const ORG_PER_HOUR = 200;
    /** Row ceilings on the grounding queries. Over one, the request is refused as too large (as an over-long context is), never truncated. */
    private const MAX_STAFF = 2000;
    private const MAX_SHIFTS = 5000;
    private const MAX_LEAVE = 5000;
    private const MAX_AVAILABILITY = 5000;
    private const MAX_CATALOGUE = 500;

    private const ROTA_SYSTEM_PROMPT = <<<'TXT'
You are RotaFlow's rota-drafting assistant for a workforce scheduling app. You suggest shifts for a manager based on real staff data. Never invent staff or shift types, only use the ids given in the context. Staff are identified only by short ids such as S1 and S2. Refer to a person by that id in the summary and reasoning, and never guess at a name.

Hard rules, in priority order. Breaking one makes the whole suggestion useless:
1. Never schedule someone whose id appears in context.approvedLeave for a date inside that leave.
2. Never schedule someone on a date they are listed as unavailable for in context.unavailability (recurring rows give a weekday where 0 = Sunday; one-off rows give a date).
3. Never create a shift that overlaps one the person already has in context.existingShifts.
4. Leave at least 11 hours between the end of one shift and the start of that person's next (the Working Time Regulations rest period).
5. Prefer people whose scheduledHours are below their weeklyHours, and prefer zero-hours staff (weeklyHours 0) for extra cover over pushing a contracted person into overtime.
6. Prefer people who already work the same shiftTypeId at the same location. They know the pattern.
7. Never give the same person two shifts on the same date, and never give one person every open shift. Spread the work across the roster.
8. When you set a shiftTypeId, use that type's defaultStart and defaultEnd as startTime and endTime unless the manager explicitly asked for different hours. The shift type owns its times.

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
}
TXT;

    private const ANNOUNCEMENT_SYSTEM_PROMPT = <<<'TXT'
You are RotaFlow's communications assistant. You draft a single staff announcement for a manager, grounded in what is genuinely happening on their rota.

Rules:
- Use only facts present in the context. Never invent a date, a name, a site or a number.
- Staff are identified only by short ids such as S1 and S2. To mention a person, write their id exactly (for example "S3 is covering Friday"); it is replaced with their name before anyone reads it.
- Write in British English, plain and warm, addressed to the whole team. No corporate padding.
- Two to four sentences in the body. Say what is happening, what the team needs to do, and by when.
- Set "urgent" true only for genuine time-critical safety or cover matters, never for routine notices.
- If the manager's request is not supported by the context, say so plainly in the body rather than inventing detail to fill it.

Respond with ONLY a single JSON object (no markdown, no commentary outside the JSON) matching exactly:
{
  "title": string, // under 80 characters, no trailing full stop
  "body": string,
  "urgent": boolean,
  "reasoning": string // one sentence on which facts you drew on
}
TXT;

    /** @param ?callable(string $method, string $url, array<string,string> $headers, string $body):array{0:int,1:string} $transport OpenRouter HTTP transport, injected by tests */
    public function __construct(private readonly Ctx $ctx, private $transport = null) {}

    public function routes(): array
    {
        return [
            ['POST', '/orgs/{o}/ai/rota', fn (array $u, array $in, string $ip, string $o): array => $this->run('rota', $u, $in, $ip, $o)],
            ['POST', '/orgs/{o}/ai/announcement', fn (array $u, array $in, string $ip, string $o): array => $this->run('announcement', $u, $in, $ip, $o)],
        ];
    }

    /** @param array<string,mixed> $user @param array<string,mixed> $in @return array{0:int,1:array<string,mixed>} */
    private function run(string $task, array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;

        // 1. Who. Membership first (404 for a stranger), then the role from the database.
        $m = Scope::membership($pdo, $user['id'], $o);
        if ($m['role'] === 'support' || !in_array($m['effective_role'], Scope::MANAGERS, true)) {
            throw HttpError::forbidden('Only owners and managers can use the AI assistant');
        }
        Scope::requireWritable($m); // an organisation that is not active spends nothing

        // The request itself, refused at its cheapest point: before the plan lookup, the flag, the quota and long before OpenRouter.
        $prompt = AiStaffAliases::trim(Input::str($in, 'prompt'));
        $start = Input::optDate($in, 'periodStart');
        $end = Input::optDate($in, 'periodEnd');
        if ($prompt === '' || $start === null || $end === null) {
            throw HttpError::invalid('prompt, periodStart and periodEnd are required');
        }
        if (strcmp($end, $start) < 0) {
            throw HttpError::invalid('periodEnd must not be before periodStart');
        }
        if (Str::len($prompt) > self::MAX_PROMPT_CHARS) {
            throw new HttpError(400, 'prompt_too_long', 'That request is too long. Keep it under ' . self::MAX_PROMPT_CHARS . ' characters.');
        }

        // 2. The plan entitlement, checked HERE and not only in the browser: each call spends real money at OpenRouter, and a hidden
        // button is not a control. Fails closed: an error resolving the entitlement refuses.
        try {
            $entitled = BillingState::hasFeature($pdo, $o, self::FEATURE);
        } catch (\Throwable) {
            $this->ctx->log('ai: entitlement lookup failed');
            $entitled = false;
        }
        if (!$entitled) {
            $body = HttpError::body('plan_required', 'The AI assistant is included with the Business and Enterprise plans. Upgrade in Settings → Billing to use it.');
            $body['error']['feature'] = self::FEATURE;
            return [403, $body];
        }

        // 3. The platform's kill switch. Fails closed too.
        try {
            $on = Flags::enabledForOrg($pdo, self::FEATURE, $o);
        } catch (\Throwable) {
            $this->ctx->log('ai: flag lookup failed');
            $on = false;
        }
        if (!$on) {
            throw new HttpError(403, 'feature_off', 'The AI assistant has been switched off for now. Please try again later.');
        }

        // 4. Configured? Before the quota, so an unconfigured server never consumes anyone's allowance.
        $key = $this->apiKey();
        if ($key === null) {
            throw new HttpError(503, 'ai_unavailable', 'AI drafting is not configured on this server yet.');
        }

        // 5. Per-person ceiling, then a ceiling on the ORGANISATION because the invoice arrives per organisation. Placed after the role and
        // entitlement checks: somebody who may not use the assistant at all cannot consume a quota by asking.
        $this->consume('ai-assistant', $user['id'], self::USER_PER_HOUR, 'You have used the AI assistant a lot in the last hour. Try again shortly.');
        $this->consume('ai-assistant-org', $o, self::ORG_PER_HOUR, 'Your organisation has reached its hourly limit for the AI assistant. Try again shortly.');

        try {
            return $this->generate($task, $m, $user, $in, $ip, $o, $prompt, $start, $end, $key);
        } catch (HttpError $e) {
            throw $e;
        } catch (\Throwable) {
            $this->ctx->log('ai: unexpected failure');
            throw new HttpError(500, 'ai_failed', 'Unexpected error generating suggestions');
        }
    }

    /** @param array<string,mixed> $m @param array<string,mixed> $user @param array<string,mixed> $in @return array{0:int,1:array<string,mixed>} */
    private function generate(string $task, array $m, array $user, array $in, string $ip, string $o, string $prompt, string $start, string $end, string $key): array
    {
        $g = $this->load($o, $start, $end);
        $staff = $g['staff'];
        if ($staff === []) {
            return [200, ['summary' => 'No active staff are set up for this organisation yet, so nothing can be suggested. Add staff profiles first.', 'suggestions' => []]];
        }

        $staffById = [];
        foreach ($staff as $s) {
            $staffById[$s['id']] = $s;
        }
        // Roster names never leave this server. The model sees S1, S2...; AiStaffAliases maps both ways.
        $aliases = new AiStaffAliases(array_map(static fn (array $s): array => ['id' => $s['id'], 'first_name' => $s['first_name'], 'last_name' => $s['last_name']], $staff));
        $shiftTypeById = [];
        foreach ($g['shiftTypes'] as $t) {
            $shiftTypeById[$t['id']] = $t;
        }
        $locationNameById = [];
        foreach ($g['locations'] as $l) {
            $locationNameById[$l['id']] = $l['name'];
        }
        $shifts = $g['shifts'];

        // Hours already scheduled per person this period, so the model can see who has headroom.
        $scheduledHours = [];
        foreach ($shifts as $s) {
            if ($s['staff_profile_id'] === null) {
                continue;
            }
            $minutes = (strtotime($s['ends_at'] . ' UTC') - strtotime($s['starts_at'] . ' UTC')) / 60 - $s['break_minutes'];
            $scheduledHours[$s['staff_profile_id']] = ($scheduledHours[$s['staff_profile_id']] ?? 0) + max(0, $minutes) / 60;
        }
        $iso = static fn (string $utc): ?string => Time::iso($utc);

        $context = [
            'organisation' => $m['org_name'] !== '' ? $m['org_name'] : 'this organisation',
            'period' => ['start' => $start, 'end' => $end],
            'staff' => array_map(fn (array $s): array => [
                'id' => $aliases->aliasFor($s['id']),
                'jobTitle' => $s['job_title'],
                'skills' => $s['skills'],
                'weeklyHours' => $s['weekly_hours'],
                'contractType' => $s['contract_type'],
                'scheduledHours' => round($scheduledHours[$s['id']] ?? 0.0, 1),
            ], $staff),
            'shiftTypes' => array_map(static fn (array $t): array => ['id' => $t['id'], 'name' => $t['name'], 'defaultStart' => $t['default_start'], 'defaultEnd' => $t['default_end']], $g['shiftTypes']),
            'locations' => array_map(static fn (array $l): array => ['id' => $l['id'], 'name' => $l['name']], $g['locations']),
            // Rows for people who are not on the active roster are left out: they have no alias, and nobody to double-book.
            'existingShifts' => array_values(array_map(fn (array $s): array => [
                'staffProfileId' => $aliases->aliasFor((string) $s['staff_profile_id']),
                'shiftTypeId' => $s['shift_type_id'],
                'locationId' => $s['location_id'],
                'startsAt' => $iso($s['starts_at']),
                'endsAt' => $iso($s['ends_at']),
            ], array_filter($shifts, fn (array $s): bool => $s['staff_profile_id'] !== null && $aliases->aliasFor($s['staff_profile_id']) !== null))),
            'openShifts' => array_values(array_map(static fn (array $s): array => [
                'shiftTypeId' => $s['shift_type_id'],
                'shiftTypeName' => $s['shift_type_id'] !== null ? ($shiftTypeById[$s['shift_type_id']]['name'] ?? null) : null,
                'location' => $s['location_id'] !== null ? ($locationNameById[$s['location_id']] ?? null) : null,
                'startsAt' => $iso($s['starts_at']),
                'endsAt' => $iso($s['ends_at']),
            ], array_filter($shifts, static fn (array $s): bool => $s['staff_profile_id'] === null && $s['status'] !== 'cancelled'))),
            // `type` is deliberately NOT sent: leave types include sick leave, this array joins to the staff array by id, and a named
            // person's sickness-absence dates must not leave for a model provider (special-category health data, UK GDPR Article 9).
            // The only rule that reads it, "never schedule someone on approved leave", needs the dates and not the reason.
            'approvedLeave' => array_values(array_map(fn (array $l): array => [
                'staffProfileId' => $aliases->aliasFor($l['staff_profile_id']),
                'startDate' => $l['start_date'],
                'endDate' => $l['end_date'],
            ], array_filter($g['leave'], fn (array $l): bool => $aliases->aliasFor($l['staff_profile_id']) !== null))),
            'unavailability' => array_values(array_map(fn (array $a): array => [
                'staffProfileId' => $aliases->aliasFor($a['staff_profile_id']),
                'weekday' => $a['recurring'] ? $a['weekday'] : null, // 0 = Sunday
                'date' => $a['date'],
            ], array_filter($g['availability'], fn (array $a): bool => $aliases->aliasFor($a['staff_profile_id']) !== null))),
        ];

        // Compact, not pretty-printed: the indentation was a fifth of every request in whitespace nobody reads.
        $serialised = json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        if (!is_string($serialised) || Str::len($serialised) > self::MAX_CONTEXT_CHARS) {
            // Refused, not trimmed: dropping staff or shifts to fit would answer with a rota that ignores part of the roster and give no
            // sign of it, and "the AI missed three people" is a bug nobody can see.
            throw new HttpError(413, 'context_too_large', 'There is too much on this rota for the assistant to read in one go. Narrow the period, or ask about one site at a time.');
        }
        $userPrompt = "Context:\n" . $serialised . "\n\nManager's request: \"" . $aliases->maskPrompt($prompt) . '"';

        [$model, $fallback] = $this->models();
        $completion = $this->complete($key, $model, $fallback, $task, $task === 'announcement' ? self::ANNOUNCEMENT_SYSTEM_PROMPT : self::ROTA_SYSTEM_PROMPT, $userPrompt);
        $usage = [
            'promptTokens' => self::tokens($completion['usage']['prompt_tokens'] ?? null),
            'completionTokens' => self::tokens($completion['usage']['completion_tokens'] ?? null),
            'totalTokens' => self::tokens($completion['usage']['total_tokens'] ?? null),
        ];
        $content = $completion['choices'][0]['message']['content'] ?? null;
        if (!is_string($content) || $content === '') {
            throw new HttpError(502, 'ai_empty_response', 'The AI assistant returned an empty response');
        }
        $parsed = self::extractJson($content);
        if ($parsed === null) {
            $this->ctx->log('ai: unreadable model reply'); // the reply itself is never logged
            throw new HttpError(502, 'ai_unreadable_response', 'The AI assistant returned an unreadable response');
        }
        $base = ['model' => $model, 'promptVersion' => self::PROMPT_VERSION, 'promptLength' => Str::len($prompt)];

        if ($task === 'announcement') {
            return $this->announcement($parsed, $aliases, $o, $user['id'], $ip, $prompt, $start, $end, $m['org_name'], $staff, $g['shiftTypes'], $g['locations'], $base, $usage, Str::len($serialised));
        }

        return $this->rota($parsed, $aliases, $o, $user['id'], $ip, $start, $end, $staffById, $shiftTypeById, $g, $base, $usage, Str::len($serialised));
    }

    // ---- the announcement task ---------------------------------------------------------------------------------------------

    /**
     * @param array<string,mixed> $parsed
     * @param list<array<string,mixed>> $staff
     * @param list<array<string,mixed>> $shiftTypes
     * @param list<array<string,mixed>> $locations
     * @param array<string,mixed> $base
     * @param array<string,int> $usage
     * @return array{0:int,1:array<string,mixed>}
     */
    private function announcement(array $parsed, AiStaffAliases $aliases, string $o, string $actor, string $ip, string $prompt, string $start, string $end, string $orgName, array $staff, array $shiftTypes, array $locations, array $base, array $usage, int $contextLength): array
    {
        // Aliases back to names first, so the grounding check below and the manager both read the same text.
        $title = is_string($parsed['title'] ?? null) ? $aliases->restoreNames(AiStaffAliases::trim($parsed['title'])) : '';
        $body = is_string($parsed['body'] ?? null) ? $aliases->restoreNames(AiStaffAliases::trim($parsed['body'])) : '';
        if ($title === '' || $body === '') {
            throw new HttpError(502, 'ai_empty_announcement', 'The AI assistant returned an announcement with no title or body');
        }

        $grounding = AiGrounding::checkAnnouncementGrounding($title, $body, $start, $end, $prompt, [
            $orgName,
            ...array_map(static fn (array $s): string => $s['first_name'] . ' ' . $s['last_name'], $staff),
            ...array_map(static fn (array $t): string => $t['name'], $shiftTypes),
            ...array_map(static fn (array $l): string => $l['name'], $locations),
        ]);

        // A date in neither the rota period nor the manager's own words is a fabrication, and it is the one that costs a shift. Refused
        // rather than returned with a warning, because the composer pre-fills its fields: a warning beside text already in the box is read
        // after it is posted.
        if ($grounding['ungroundedDates'] !== []) {
            $this->audit($o, $actor, 'announcement', 'ai_assistant.announcement_rejected', $base + ['reason' => 'ungrounded_dates', 'ungroundedDates' => $grounding['ungroundedDates']], $ip);
            throw new HttpError(502, 'ai_ungrounded_date', 'The draft mentioned a date that is not in this rota period or in your request, so it was not used. Try again, or write the announcement yourself.');
        }

        $urgent = ($parsed['urgent'] ?? null) === true;
        $this->audit($o, $actor, 'announcement', 'ai_assistant.announcement_drafted', $base + [
            'contextLength' => $contextLength,
            'usage' => $usage,
            'titleLength' => Str::len($title),
            'bodyLength' => Str::len($body),
            'urgent' => $urgent,
            // Recorded even when it passes, so the false-positive rate of the name check is measurable rather than guessed at.
            'suspectNames' => $grounding['suspectNames'],
        ], $ip);
        return [200, [
            'title' => Str::cut($title, 120),
            'body' => $body,
            'urgent' => $urgent,
            'reasoning' => is_string($parsed['reasoning'] ?? null) ? $aliases->restoreNames($parsed['reasoning']) : '',
            // Warned, not refused: English capitalises plenty of words that are not names.
            'unverified' => $grounding['suspectNames'],
        ]];
    }

    // ---- the rota task: verify, then repair, then drop ---------------------------------------------------------------------

    /**
     * The model is TOLD the rules, but "told" is not "verified". So ids are checked against real rows, times are snapped to the chosen
     * shift type's own defaults, and anything that still overlaps an existing shift or an already-accepted suggestion is dropped. What
     * was dropped is reported in the summary rather than silently disappearing.
     *
     * @param array<string,mixed> $parsed
     * @param array<string,array<string,mixed>> $staffById
     * @param array<string,array<string,mixed>> $shiftTypeById
     * @param array<string,mixed> $g
     * @param array<string,mixed> $base
     * @param array<string,int> $usage
     * @return array{0:int,1:array<string,mixed>}
     */
    private function rota(array $parsed, AiStaffAliases $aliases, string $o, string $actor, string $ip, string $start, string $end, array $staffById, array $shiftTypeById, array $g, array $base, array $usage, int $contextLength): array
    {
        $tz = $this->timezone($g['locations'], $g['org_timezone']);

        // Wall-clock minute ranges of what each person is already working. Overlap has to be judged in the zone the rota is written in:
        // the model returns a local date and "HH:MM", while stored shifts are UTC instants.
        $busy = [];
        foreach ($g['shifts'] as $s) {
            if ($s['staff_profile_id'] !== null) {
                $busy[$s['staff_profile_id']][] = ['start' => self::zonedMinutes($s['starts_at'], $tz), 'end' => self::zonedMinutes($s['ends_at'], $tz)];
            }
        }

        $accepted = [];
        $dropped = ['unknown' => 0, 'period' => 0, 'overlap' => 0, 'leave' => 0, 'unavailable' => 0];
        $retimed = 0;

        $list = is_array($parsed['suggestions'] ?? null) && array_is_list($parsed['suggestions']) ? $parsed['suggestions'] : [];
        $raw = [];
        foreach ($list as $s) {
            if (!is_array($s)) {
                $dropped['unknown']++; // not even an object
                continue;
            }
            // Entries without a date and both times vanish, as before (they are not suggestions); entries with the wrong TYPE are counted.
            if (empty($s['date']) || empty($s['startTime']) || empty($s['endTime'])) {
                continue;
            }
            if (!is_string($s['date']) || !is_string($s['startTime']) || !is_string($s['endTime'])) {
                $dropped['unknown']++;
                continue;
            }
            $raw[] = $s;
        }
        usort($raw, static fn (array $a, array $b): int => strcmp($a['date'] . 'T' . $a['startTime'], $b['date'] . 'T' . $b['startTime']));

        foreach ($raw as $s) {
            // The model answers in aliases. Anything that is not one of ours, including a real id it could not have seen, is unknown.
            $staffProfileId = is_string($s['staffProfileId'] ?? null) ? $aliases->idFor($s['staffProfileId']) : null;
            $member = $staffProfileId !== null ? ($staffById[$staffProfileId] ?? null) : null;
            if ($staffProfileId === null || $member === null) {
                $dropped['unknown']++;
                continue;
            }
            $date = $s['date'];
            // A real calendar date or nothing: a date the string comparisons below would wave through cannot be placed on a grid.
            if (AiGrounding::weekday($date) === null) {
                $dropped['unknown']++;
                continue;
            }
            if (strcmp($date, $start) < 0 || strcmp($date, $end) > 0) {
                $dropped['period']++;
                continue;
            }

            $block = AiGrounding::suggestionDateBlock($staffProfileId, $date, $g['leave'], $g['availability']);
            if ($block === 'leave') {
                $dropped['leave']++;
                continue;
            }
            if ($block === 'unavailable') {
                $dropped['unavailable']++;
                continue;
            }

            $shiftType = is_string($s['shiftTypeId'] ?? null) ? ($shiftTypeById[$s['shiftTypeId']] ?? null) : null;

            // A shift type owns its hours. If the model named one, its defaults win over whatever times came back: that is also exactly
            // what dragging the type onto the grid does, so the two routes agree.
            $startTime = $s['startTime'];
            $endTime = $s['endTime'];
            if ($shiftType !== null && $shiftType['default_start'] !== null && $shiftType['default_end'] !== null) {
                $typeStart = substr((string) $shiftType['default_start'], 0, 5);
                $typeEnd = substr((string) $shiftType['default_end'], 0, 5);
                if ($typeStart !== $startTime || $typeEnd !== $endTime) {
                    $retimed++;
                }
                $startTime = $typeStart;
                $endTime = $typeEnd;
            }
            if (preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $startTime) !== 1 || preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $endTime) !== 1 || $startTime === $endTime) {
                $dropped['unknown']++;
                continue;
            }

            $from = self::localMinutes($date, $startTime);
            // A night shift ending "07:15" ends the following morning.
            $to = self::localMinutes($date, $endTime) + (strcmp($endTime, $startTime) <= 0 ? 1440 : 0);

            $mine = $busy[$staffProfileId] ?? [];
            foreach ($mine as $b) {
                if ($from < $b['end'] && $b['start'] < $to) {
                    $dropped['overlap']++;
                    continue 2;
                }
            }

            $accepted[] = [
                'staffProfileId' => $staffProfileId,
                'staffName' => AiStaffAliases::fullName($member),
                'shiftTypeId' => $shiftType !== null ? $shiftType['id'] : null,
                'shiftTypeName' => $shiftType !== null ? $shiftType['name'] : null,
                'date' => $date,
                'startTime' => $startTime,
                'endTime' => $endTime,
                'reasoning' => is_string($s['reasoning'] ?? null) ? $aliases->restoreNames($s['reasoning']) : '',
            ];
            // Accepted suggestions become "busy" too, so the next one in the same response cannot double-book the same person.
            $busy[$staffProfileId][] = ['start' => $from, 'end' => $to];
        }

        $notes = [];
        if ($retimed > 0) {
            $notes[] = "$retimed suggestion" . ($retimed === 1 ? ' was' : 's were') . " re-timed to match the shift type's own hours.";
        }
        if ($dropped['overlap'] > 0) {
            $notes[] = "{$dropped['overlap']} dropped for clashing with a shift that person already has.";
        }
        if ($dropped['leave'] > 0) {
            $notes[] = "{$dropped['leave']} dropped because that person is on approved leave.";
        }
        if ($dropped['unavailable'] > 0) {
            $notes[] = "{$dropped['unavailable']} dropped because that person is unavailable.";
        }
        if ($dropped['period'] > 0) {
            $notes[] = "{$dropped['period']} dropped for falling outside the period.";
        }
        if ($dropped['unknown'] > 0) {
            $notes[] = "{$dropped['unknown']} dropped for naming staff or times that do not exist.";
        }

        $modelSummary = is_string($parsed['summary'] ?? null) ? $aliases->restoreNames($parsed['summary']) : '';
        // This is also the invalid-suggestion-rate measurement: how many were accepted against how many were dropped, and why.
        $this->audit($o, $actor, 'rota', 'ai_assistant.rota_suggestions_generated', $base + [
            'contextLength' => $contextLength,
            'usage' => $usage,
            'periodStart' => $start,
            'periodEnd' => $end,
            'raw' => count($raw),
            'accepted' => count($accepted),
            'droppedUnknown' => $dropped['unknown'],
            'droppedOutOfPeriod' => $dropped['period'],
            'droppedOverlapping' => $dropped['overlap'],
            'droppedLeave' => $dropped['leave'],
            'droppedUnavailable' => $dropped['unavailable'],
            'retimed' => $retimed,
        ], $ip);
        return [200, ['summary' => $notes !== [] ? AiStaffAliases::trim($modelSummary . ' ' . implode(' ', $notes)) : $modelSummary, 'suggestions' => $accepted]];
    }

    // ---- the grounding query -----------------------------------------------------------------------------------------------

    /**
     * Everything the model is told, read with the organisation id on every query. Overlap is judged against shifts that OVERLAP the
     * period, not only those that start in it, so a night shift beginning the evening before the period still blocks the next morning.
     * Cancelled shifts still count (as before): a suggestion over one is dropped rather than risked.
     *
     * @return array{staff:list<array<string,mixed>>,shiftTypes:list<array<string,mixed>>,shifts:list<array<string,mixed>>,leave:list<array<string,mixed>>,availability:list<array<string,mixed>>,locations:list<array<string,mixed>>,org_timezone:?string}
     */
    private function load(string $o, string $start, string $end): array
    {
        $pdo = $this->ctx->pdo;
        $tooLarge = static fn (): HttpError => new HttpError(413, 'context_too_large', 'There is too much on this rota for the assistant to read in one go. Narrow the period, or ask about one site at a time.');
        try {
            $q = $pdo->prepare('SELECT id, first_name, last_name, job_title, skills, weekly_hours, contract_type FROM staff_profiles WHERE org_id = ? AND active = 1 ORDER BY id LIMIT ' . (self::MAX_STAFF + 1));
            $q->execute([$o]);
            $staff = [];
            foreach ($q->fetchAll() as $r) {
                $skills = json_decode((string) $r['skills'], true);
                $staff[] = ['id' => (string) $r['id'], 'first_name' => (string) $r['first_name'], 'last_name' => (string) $r['last_name'], 'job_title' => $r['job_title'],
                    'skills' => is_array($skills) ? array_values(array_filter($skills, 'is_string')) : [], 'weekly_hours' => self::num($r['weekly_hours']), 'contract_type' => $r['contract_type']];
            }
            $q = $pdo->prepare('SELECT id, name, default_start, default_end FROM shift_types WHERE org_id = ? ORDER BY name, id LIMIT ' . (self::MAX_CATALOGUE + 1));
            $q->execute([$o]);
            $shiftTypes = $q->fetchAll();
            $q = $pdo->prepare('SELECT id, name, timezone FROM locations WHERE org_id = ? ORDER BY created_at, id LIMIT ' . (self::MAX_CATALOGUE + 1));
            $q->execute([$o]);
            $locations = $q->fetchAll();
            $q = $pdo->prepare('SELECT id, staff_profile_id, shift_type_id, location_id, starts_at, ends_at, break_minutes, status FROM shifts WHERE org_id = ? AND starts_at < ? AND ends_at > ? ORDER BY starts_at, id LIMIT ' . (self::MAX_SHIFTS + 1));
            $q->execute([$o, self::nextDay($end) . ' 00:00:00', $start . ' 00:00:00']);
            $shifts = array_map(static fn (array $r): array => ['id' => (string) $r['id'], 'staff_profile_id' => $r['staff_profile_id'], 'shift_type_id' => $r['shift_type_id'], 'location_id' => $r['location_id'],
                'starts_at' => (string) $r['starts_at'], 'ends_at' => (string) $r['ends_at'], 'break_minutes' => (int) $r['break_minutes'], 'status' => (string) $r['status']], $q->fetchAll());
            $q = $pdo->prepare("SELECT staff_profile_id, start_date, end_date FROM leave_requests WHERE org_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ? LIMIT " . (self::MAX_LEAVE + 1));
            $q->execute([$o, $end, $start]);
            $leave = array_map(static fn (array $r): array => ['staff_profile_id' => (string) $r['staff_profile_id'], 'start_date' => (string) $r['start_date'], 'end_date' => (string) $r['end_date']], $q->fetchAll());
            // A one-off row outside the period can never match a date inside it, so only recurring rows and in-period dates are read.
            $q = $pdo->prepare("SELECT staff_profile_id, weekday, date, recurring FROM availability WHERE org_id = ? AND status = 'unavailable' AND (date IS NULL OR (date >= ? AND date <= ?)) LIMIT " . (self::MAX_AVAILABILITY + 1));
            $q->execute([$o, $start, $end]);
            $availability = array_map(static fn (array $r): array => ['staff_profile_id' => (string) $r['staff_profile_id'], 'weekday' => $r['weekday'] === null ? null : (int) $r['weekday'],
                'date' => $r['date'] === null ? null : (string) $r['date'], 'recurring' => (int) $r['recurring'] === 1], $q->fetchAll());
            $q = $pdo->prepare('SELECT timezone FROM organisations WHERE id = ?');
            $q->execute([$o]);
            $orgTz = $q->fetchColumn();
        } catch (\PDOException) {
            $this->ctx->log('ai: grounding query failed');
            throw new HttpError(503, 'ai_unavailable', 'The assistant could not verify the rota, leave and availability data. Please try again shortly.');
        }
        if (count($staff) > self::MAX_STAFF || count($shiftTypes) > self::MAX_CATALOGUE || count($locations) > self::MAX_CATALOGUE || count($shifts) > self::MAX_SHIFTS
            || count($leave) > self::MAX_LEAVE || count($availability) > self::MAX_AVAILABILITY) {
            throw $tooLarge();
        }
        return ['staff' => $staff, 'shiftTypes' => $shiftTypes, 'shifts' => $shifts, 'leave' => $leave, 'availability' => $availability, 'locations' => $locations, 'org_timezone' => is_string($orgTz) ? $orgTz : null];
    }

    // ---- OpenRouter --------------------------------------------------------------------------------------------------------

    /**
     * One model, or two: with a fallback configured, OpenRouter routes to the second inside the same request when the first fails, which
     * costs no extra round trip and cannot double-charge for a call that succeeded. Unset, a provider outage is a 502.
     *
     * @return array<string,mixed>
     */
    private function complete(string $key, string $model, ?string $fallback, string $task, string $system, string $user): array
    {
        $routing = $fallback !== null && $fallback !== $model ? ['models' => [$model, $fallback], 'route' => 'fallback'] : [];
        $body = json_encode([
            'model' => $model,
            ...$routing,
            'temperature' => $task === 'announcement' ? 0.5 : 0.3,
            // A ceiling on what one call can cost. A truncated reply fails the JSON parse and is reported as a failure, which is better
            // than silently applying half a rota.
            'max_tokens' => 2000,
            'response_format' => ['type' => 'json_object'],
            'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $user]],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        $referer = rtrim($this->ctx->appUrl, '/');
        $headers = ['Authorization' => 'Bearer ' . $key, 'Content-Type' => 'application/json', 'HTTP-Referer' => $referer !== '' ? $referer : 'https://rotaflow.space', 'X-Title' => 'RotaFlow'];
        if (!is_string($body)) {
            throw new HttpError(502, 'ai_unavailable', 'The AI assistant is temporarily unavailable');
        }
        try {
            [$status, $raw] = ($this->transport ?? self::curl(...))('POST', self::ENDPOINT, $headers, $body);
        } catch (\Throwable) {
            $this->ctx->log('ai: openrouter transport failed'); // never the message: it could echo the request
            throw new HttpError(502, 'ai_unavailable', 'The AI assistant is temporarily unavailable');
        }
        $json = json_decode($raw, true);
        if ($status < 200 || $status >= 300 || !is_array($json)) {
            $this->ctx->log('ai: openrouter status ' . $status); // the status only, never the body
            throw new HttpError(502, 'ai_unavailable', 'The AI assistant is temporarily unavailable');
        }
        return $json;
    }

    /** @return array{0:int,1:string} */
    private static function curl(string $method, string $url, array $headers, string $body): array
    {
        if (function_exists('set_time_limit')) {
            @set_time_limit(75);
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => array_map(static fn (string $k, string $v): string => "$k: $v", array_keys($headers), $headers)]);
        $out = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$code, is_string($out) ? $out : ''];
    }

    /** The configured key, or null. A value that could not be a header (spaces, control characters) counts as not configured. */
    private function apiKey(): ?string
    {
        $k = $this->ctx->config['openrouter_api_key'] ?? null;
        return is_string($k) && preg_match('/^[\x21-\x7e]{8,300}$/D', $k) === 1 ? $k : null;
    }

    /** @return array{0:string,1:?string} the primary model and the optional fallback */
    private function models(): array
    {
        $ok = static fn (mixed $v): ?string => is_string($v) && preg_match('~^[A-Za-z0-9._:/-]{1,100}$~D', $v) === 1 ? $v : null;
        return [$ok($this->ctx->config['openrouter_model'] ?? null) ?? self::DEFAULT_MODEL, $ok($this->ctx->config['openrouter_fallback_model'] ?? null)];
    }

    // ---- small helpers -----------------------------------------------------------------------------------------------------

    /** A hit on a limiter, with this feature's own wording. A limiter that itself fails refuses: a broken limiter must not become a free pass on the one endpoint that spends money. */
    private function consume(string $bucket, string $subject, int $limit, string $message): void
    {
        try {
            $this->ctx->limits->hit($bucket, $subject, $limit, 3600);
        } catch (HttpError $e) {
            if ($e->status === 429) {
                throw new HttpError(429, 'rate_limited', $message);
            }
            throw $e;
        } catch (\Throwable) {
            $this->ctx->log('ai: rate limit check failed');
            throw new HttpError(503, 'ai_unavailable', 'The AI assistant is unavailable right now. Please try again shortly.');
        }
    }

    /** Audit is best effort: it must never turn a successful suggestion into a failed response over a logging problem. @param array<string,mixed> $meta */
    private function audit(string $o, string $actor, string $entity, string $action, array $meta, string $ip): void
    {
        try {
            Audit::log($this->ctx->pdo, $o, $actor, $action, $entity, null, $meta, 'info', 'org', $ip);
        } catch (\Throwable) {
            $this->ctx->log('ai: audit write failed');
        }
    }

    /** The model's JSON, bare or inside a code fence. Null when it is not a JSON object. @return ?array<string,mixed> */
    public static function extractJson(string $content): ?array
    {
        $raw = preg_match('/```(?:json)?\s*([\s\S]*?)\s*```/i', $content, $m) === 1 ? $m[1] : $content;
        try {
            $v = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
        return is_array($v) && ($v === [] || !array_is_list($v)) ? $v : null;
    }

    /** The zone the rota is written in: the first site's, else the organisation's, else London. An unknown zone name is not trusted. @param list<array<string,mixed>> $locations */
    private function timezone(array $locations, ?string $orgTimezone): \DateTimeZone
    {
        foreach ([$locations[0]['timezone'] ?? null, $orgTimezone, 'Europe/London'] as $name) {
            if (is_string($name) && $name !== '' && in_array($name, \DateTimeZone::listIdentifiers(), true)) {
                return new \DateTimeZone($name);
            }
        }
        return new \DateTimeZone('Europe/London');
    }

    /** Wall-clock minutes since the epoch (as if that wall clock were UTC) of a stored UTC instant, in a zone. */
    public static function zonedMinutes(string $utc, \DateTimeZone $tz): int
    {
        $ts = (int) strtotime($utc . ' UTC');
        return (int) floor(($ts + $tz->getOffset(new \DateTimeImmutable('@' . $ts))) / 60);
    }

    /** The same scale for a local date and "HH:MM". The date is already known to be real. */
    public static function localMinutes(string $date, string $hhmm): int
    {
        [$h, $mi] = array_map('intval', explode(':', $hhmm) + [0, 0]);
        return (int) floor((int) strtotime($date . ' 00:00:00 UTC') / 60) + $h * 60 + $mi;
    }

    /** OpenRouter's own token accounting; anything that is not a plain number counts as zero. */
    private static function tokens(mixed $v): int
    {
        return is_int($v) || is_float($v) || (is_string($v) && is_numeric($v)) ? max(0, (int) $v) : 0;
    }

    private static function nextDay(string $date): string
    {
        return (new \DateTimeImmutable($date . ' UTC'))->modify('+1 day')->format('Y-m-d');
    }

    private static function num(mixed $v): int|float|null
    {
        if ($v === null) {
            return null;
        }
        $f = (float) $v;
        return $f == floor($f) ? (int) $f : $f;
    }
}
