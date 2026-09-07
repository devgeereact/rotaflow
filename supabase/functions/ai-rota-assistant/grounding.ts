/**
 * Checking an AI-drafted announcement against the facts it was given
 * (docs/SAAS.md BUG-058).
 *
 * ## Why this exists
 *
 * The rota task verifies every suggestion: ids are matched to real rows, times
 * are snapped to the shift type's own defaults, and anything overlapping is
 * dropped. The announcement task did none of that — a title/body presence
 * check, then the model's prose straight back to the manager's composer with
 * the fields pre-filled. `ANNOUNCEMENT_SYSTEM_PROMPT` says "never invent a
 * date, a name, a site or a number", and being told a rule is not the same as
 * being held to one. The rota task carries a comment recording that gpt-4o-mini
 * invented shift hours in testing while being told the same kind of rule.
 *
 * A wrong date in a staff announcement is the expensive failure in this
 * product: people come in on the wrong day, or do not come in at all.
 *
 * ## What can honestly be checked, and what cannot
 *
 * Prose cannot be validated the way a list of ids can. Two classes are
 * decidable, and the rest is deliberately left alone rather than guessed at:
 *
 *   DATES — decidable. Every date the draft may legitimately mention is
 *   either inside the rota period it was given, or was written by the manager
 *   in their own prompt. A date in neither place came from nowhere. Note the
 *   prompt genuinely is a valid source: "remind everyone the Christmas rota
 *   closes on 12 December" is a manager stating a fact, not the model
 *   inventing one, and rejecting it would make the feature useless.
 *
 *   NAMES — decidable enough to WARN, never to reject. A capitalised word
 *   mid-sentence that matches no staff member, location, shift type, or word
 *   from the manager's prompt is suspicious, but English is full of
 *   capitalised words that are not names ("NHS", "Christmas", "Friday"), so
 *   this reports and does not block.
 *
 *   NUMBERS — NOT checked. "four shifts still need cover" is checkable in
 *   principle and a swamp in practice: times ("09:00"), durations, ordinals
 *   and spelled-out numbers all read as numeric claims, and a check that
 *   flags a correct draft three times out of five trains managers to ignore
 *   it. A check nobody reads is worse than no check, because it looks like
 *   one. Left open, and written down as such.
 */

export interface GroundingVocabulary {
  /** Rota period the draft was drafted against, ISO `YYYY-MM-DD`. */
  periodStart: string;
  periodEnd: string;
  /** The manager's own words. A fact they supplied is a fact. */
  prompt: string;
  /** Staff names, location names, shift type names, the organisation name. */
  known: string[];
}

export interface GroundingResult {
  /** Dates the draft asserts that are in neither the period nor the prompt. */
  ungroundedDates: string[];
  /** Name-shaped words that match nothing the model was given. */
  suspectNames: string[];
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * Words that are capitalised in ordinary British prose and are not names.
 * Weekdays and months are here because a draft SHOULD say "Friday" — the date
 * check covers whether the day it names is real, and flagging the word itself
 * would fire on every correct announcement.
 */
const NOT_NAMES = new Set([
  ...MONTHS,
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'christmas',
  'easter',
  'new',
  'year',
  'bank',
  'holiday',
  'nhs',
  'covid',
  'england',
  'scotland',
  'wales',
  'ireland',
  'uk',
  'am',
  'pm',
  'i',
]);

/** Every ISO date in a period, inclusive. Periods here are days to weeks. */
function datesInPeriod(start: string, end: string): Set<string> {
  const out = new Set<string>();
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return out;
  // A guard, not a limit anyone should hit: a malformed period must not spin
  // here. 400 days is longer than any rota and short enough to be free.
  for (let t = from, n = 0; t <= to && n < 400; t += 86_400_000, n += 1) {
    const iso = new Date(t).toISOString().slice(0, 10);
    out.add(iso);
  }
  return out;
}

/**
 * Dates asserted by a piece of text, normalised to ISO where possible.
 *
 * Recognises `2027-03-04`, `4 March`, `4th March`, `March 4` and `March 4th`,
 * with or without a year. A bare day-and-month is resolved against the
 * period's year, because that is the year a draft about that period means.
 * `04/03/2027` is deliberately NOT recognised: it is ambiguous between British
 * and American order, and guessing which would mean reporting a date the
 * writer did not assert.
 */
export function extractDates(text: string, fallbackYear: number): string[] {
  const found: string[] = [];

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    found.push(`${m[1]}-${m[2]}-${m[3]}`);
  }

  const monthAlt = MONTHS.join('|');
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthAlt})(?:\\s+(\\d{4}))?\\b`,
    'gi',
  );
  const monthFirst = new RegExp(
    `\\b(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    'gi',
  );

  const push = (day: string, month: string, year: string | undefined): void => {
    const monthIndex = MONTHS.indexOf(month.toLowerCase());
    if (monthIndex < 0) return;
    const d = Number(day);
    if (!Number.isInteger(d) || d < 1 || d > 31) return;
    const y = year && /^\d{4}$/.test(year) ? Number(year) : fallbackYear;
    found.push(
      `${String(y).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    );
  };

  for (const m of text.matchAll(dayFirst)) push(m[1] ?? '', m[2] ?? '', m[3]);
  for (const m of text.matchAll(monthFirst)) push(m[2] ?? '', m[1] ?? '', m[3]);

  return [...new Set(found)];
}

/**
 * Capitalised words that are not at the start of a sentence.
 *
 * The sentence-initial exclusion is what makes this usable at all: "Please
 * check the rota" would otherwise report "Please" as an invented name on every
 * draft. It costs a real detection — an invented name opening a sentence is
 * missed — which is the right side to err on for a check that only warns.
 */
export function extractNameCandidates(text: string): string[] {
  const out: string[] = [];
  // Split on sentence enders and on newlines, since a body is often bulleted.
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    // A leading bullet or dash is not the first word. Without this, the first
    // real word of every bulleted line loses its sentence-initial exemption
    // and a body written as a list reports most of its own headings.
    const words = sentence
      .trim()
      .replace(/^[\s\-*•—–]+/, '')
      .split(/\s+/);
    for (let i = 1; i < words.length; i += 1) {
      const bare = (words[i] ?? '').replace(/[^A-Za-z'-]/g, '');
      if (bare.length < 2) continue;
      if (!/^[A-Z][a-z'-]+$/.test(bare)) continue;
      out.push(bare);
    }
  }
  return [...new Set(out)];
}

/** Lower-cased word set, for membership tests against prompt and vocabulary. */
function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9'-]+/)
      .filter(Boolean),
  );
}

export function checkAnnouncementGrounding(
  title: string,
  body: string,
  vocabulary: GroundingVocabulary,
): GroundingResult {
  const text = `${title}\n${body}`;
  const period = datesInPeriod(vocabulary.periodStart, vocabulary.periodEnd);
  // The year a bare "4 March" means. Read from the period rather than the
  // clock, and from either end of it, so a malformed start still resolves
  // deterministically — a check whose answer depends on today's date is a
  // check that cannot be tested.
  const fallbackYear =
    Number(vocabulary.periodStart.slice(0, 4)) ||
    Number(vocabulary.periodEnd.slice(0, 4)) ||
    new Date().getUTCFullYear();

  const promptDates = new Set(extractDates(vocabulary.prompt, fallbackYear));
  const ungroundedDates = extractDates(text, fallbackYear).filter(
    (d) => !period.has(d) && !promptDates.has(d),
  );

  const allowed = words([vocabulary.prompt, ...vocabulary.known].join(' '));
  const suspectNames = extractNameCandidates(text).filter((name) => {
    const lower = name.toLowerCase();
    return !allowed.has(lower) && !NOT_NAMES.has(lower);
  });

  return { ungroundedDates, suspectNames };
}
