<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Checking AI output against the facts the model was given (the PHP form of ai-rota-assistant/grounding.ts, BUG-058).
 *
 * The rota task verifies every suggestion: ids are matched to real rows, times are snapped to the shift type's own defaults, and anything
 * overlapping is dropped. The announcement task is prose, so only what is decidable is checked, and the rest is deliberately left alone:
 *
 *   DATES: decidable. Every date a draft may legitimately mention is either inside the rota period it was given, or was written by the
 *   manager in their own prompt ("the Christmas rota closes on 12 December" is a manager stating a fact, not an invention). A date in
 *   neither place came from nowhere, and it is the one that costs a shift: people turn up on the wrong day. These are refused.
 *
 *   NAMES: decidable enough to WARN, never to reject. A capitalised word mid-sentence that matches no staff member, site, shift type or
 *   word of the prompt is suspicious, but English capitalises plenty of words that are not names ("NHS", "Christmas", "Friday").
 *
 *   NUMBERS: not checked. Times, durations, ordinals and spelled-out numbers all read as numeric claims, and a check that flags a correct
 *   draft three times out of five trains managers to ignore it. A check nobody reads is worse than none, because it looks like one.
 *
 * Pure: no database, no config, no network, and no mbstring.
 */
final class AiGrounding
{
    private const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

    /**
     * Words capitalised in ordinary British prose that are not names. Weekdays and months are here because a draft SHOULD say "Friday";
     * the date check covers whether the day it names is real, and flagging the word itself would fire on every correct announcement.
     */
    private const NOT_NAMES = [
        'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
        'christmas', 'easter', 'new', 'year', 'bank', 'holiday', 'nhs', 'covid', 'england', 'scotland', 'wales', 'ireland', 'uk', 'am', 'pm', 'i',
    ];

    /**
     * Deterministic guard for the two date rules a model must never arbitrate: approved leave (inclusive on both ends) and declared
     * unavailability (a one-off date, or a recurring weekday where 0 = Sunday), for that person only.
     *
     * @param list<array{staff_profile_id:string,start_date:string,end_date:string}> $leave
     * @param list<array{staff_profile_id:string,weekday:?int,date:?string,recurring:bool}> $availability
     * @return 'leave'|'unavailable'|null
     */
    public static function suggestionDateBlock(string $staffProfileId, string $date, array $leave, array $availability): ?string
    {
        foreach ($leave as $e) {
            if ($e['staff_profile_id'] === $staffProfileId && strcmp($e['start_date'], $date) <= 0 && strcmp($e['end_date'], $date) >= 0) {
                return 'leave';
            }
        }
        $weekday = self::weekday($date);
        foreach ($availability as $e) {
            if ($e['staff_profile_id'] !== $staffProfileId) {
                continue;
            }
            if ($e['date'] === $date || ($e['recurring'] && $e['date'] === null && $weekday !== null && $e['weekday'] === $weekday)) {
                return 'unavailable';
            }
        }
        return null;
    }

    /** 0 = Sunday .. 6 = Saturday for a real calendar date, null for anything else. */
    public static function weekday(string $date): ?int
    {
        $d = self::parseDate($date);
        return $d === null ? null : (int) $d->format('w');
    }

    /**
     * Dates asserted by a piece of text, normalised to ISO where possible.
     *
     * Recognises 2027-03-04, 4 March, 4th March, March 4 and March 4th, with or without a year. A bare day-and-month is resolved against
     * the period's year, because that is the year a draft about that period means. 04/03/2027 is deliberately NOT recognised: it is
     * ambiguous between British and American order, and guessing which would mean reporting a date the writer did not assert.
     *
     * @return list<string>
     */
    public static function extractDates(string $text, int $fallbackYear): array
    {
        $found = [];
        // No /u on purpose: the patterns are ASCII, and JavaScript's \b and \d were ASCII too.
        if (preg_match_all('/\b(\d{4})-(\d{2})-(\d{2})\b/', $text, $iso, PREG_SET_ORDER) > 0) {
            foreach ($iso as $m) {
                $found[] = "$m[1]-$m[2]-$m[3]";
            }
        }
        $alt = implode('|', self::MONTHS);
        $push = static function (string $day, string $month, string $year) use (&$found, $fallbackYear): void {
            $monthIndex = array_search(strtolower($month), self::MONTHS, true);
            if ($monthIndex === false) {
                return;
            }
            $d = (int) $day;
            if ($d < 1 || $d > 31) {
                return;
            }
            $y = preg_match('/^\d{4}$/D', $year) === 1 ? (int) $year : $fallbackYear;
            $found[] = sprintf('%04d-%02d-%02d', $y, $monthIndex + 1, $d);
        };
        if (preg_match_all('/\b(\d{1,2})(?:st|nd|rd|th)?\s+(' . $alt . ')(?:\s+(\d{4}))?\b/i', $text, $dayFirst, PREG_SET_ORDER) > 0) {
            foreach ($dayFirst as $m) {
                $push($m[1], $m[2], $m[3] ?? '');
            }
        }
        if (preg_match_all('/\b(' . $alt . ')\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i', $text, $monthFirst, PREG_SET_ORDER) > 0) {
            foreach ($monthFirst as $m) {
                $push($m[2], $m[1], $m[3] ?? '');
            }
        }
        return array_values(array_unique($found));
    }

    /**
     * Capitalised words that are not at the start of a sentence.
     *
     * The sentence-initial exclusion is what makes this usable at all: "Please check the rota" would otherwise report "Please" as an
     * invented name on every draft. It costs a real detection (an invented name opening a sentence is missed), which is the right side
     * to err on for a check that only warns.
     *
     * @return list<string>
     */
    public static function extractNameCandidates(string $text): array
    {
        $out = [];
        // Split on sentence enders and on newlines, since a body is often bulleted.
        $sentences = preg_split('/(?<=[.!?])\s+|\n+/u', $text);
        foreach ($sentences === false ? [$text] : $sentences as $sentence) {
            // A leading bullet or dash is not the first word. Without this, the first real word of every bulleted line loses its
            // sentence-initial exemption and a body written as a list reports most of its own headings.
            $stripped = preg_replace('/^[\s\-*•—–]+/u', '', AiStaffAliases::trim($sentence)) ?? $sentence;
            $words = preg_split('/\s+/u', $stripped);
            if ($words === false) {
                continue;
            }
            for ($i = 1, $n = count($words); $i < $n; $i++) {
                $bare = preg_replace("/[^A-Za-z'-]/", '', $words[$i]) ?? '';
                if (strlen($bare) < 2 || preg_match("/^[A-Z][a-z'-]+$/D", $bare) !== 1) {
                    continue;
                }
                $out[] = $bare;
            }
        }
        return array_values(array_unique($out));
    }

    /**
     * @param list<string> $known staff names, location names, shift type names, the organisation name
     * @return array{ungroundedDates:list<string>,suspectNames:list<string>}
     */
    public static function checkAnnouncementGrounding(string $title, string $body, string $periodStart, string $periodEnd, string $prompt, array $known): array
    {
        $text = $title . "\n" . $body;
        $period = array_flip(self::datesInPeriod($periodStart, $periodEnd));
        // The year a bare "4 March" means. Read from the period rather than the clock, and from either end of it, so a malformed start
        // still resolves deterministically: a check whose answer depends on today's date is a check that cannot be tested.
        $fallbackYear = self::year($periodStart) ?: self::year($periodEnd) ?: (int) gmdate('Y');

        $promptDates = array_flip(self::extractDates($prompt, $fallbackYear));
        $ungrounded = array_values(array_filter(
            self::extractDates($text, $fallbackYear),
            static fn (string $d): bool => !isset($period[$d]) && !isset($promptDates[$d]),
        ));

        $allowed = array_flip(self::words(implode(' ', [$prompt, ...$known])));
        $notNames = array_flip(self::NOT_NAMES);
        $suspect = array_values(array_filter(
            self::extractNameCandidates($text),
            static function (string $name) use ($allowed, $notNames): bool {
                $lower = strtolower($name);
                return !isset($allowed[$lower]) && !isset($notNames[$lower]);
            },
        ));

        return ['ungroundedDates' => $ungrounded, 'suspectNames' => $suspect];
    }

    /** Every ISO date in a period, inclusive. A malformed or inverted period has none. At most 400 days, so a bad period cannot spin. @return list<string> */
    private static function datesInPeriod(string $start, string $end): array
    {
        $from = self::parseDate($start);
        $to = self::parseDate($end);
        if ($from === null || $to === null || $to < $from) {
            return [];
        }
        $out = [];
        for ($d = $from, $n = 0; $d <= $to && $n < 400; $d = $d->modify('+1 day'), $n++) {
            $out[] = $d->format('Y-m-d');
        }
        return $out;
    }

    /** Lower-cased word set, for membership tests against the prompt and the vocabulary. @return list<string> */
    private static function words(string $text): array
    {
        $parts = preg_split("/[^a-z0-9'-]+/", strtolower($text), -1, PREG_SPLIT_NO_EMPTY);
        return $parts === false ? [] : $parts;
    }

    private static function year(string $date): int
    {
        $y = substr($date, 0, 4);
        return is_numeric($y) ? (int) $y : 0;
    }

    private static function parseDate(string $date): ?\DateTimeImmutable
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date) !== 1) {
            return null;
        }
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $date, new \DateTimeZone('UTC'));
        return $d !== false && $d->format('Y-m-d') === $date ? $d : null;
    }
}
