import { describe, expect, it } from 'vitest';
import {
  checkAnnouncementGrounding,
  extractDates,
  extractNameCandidates,
} from './grounding';

/**
 * The first automated test of anything in `supabase/functions`.
 *
 * Those files are Deno and are excluded from `npm run typecheck` and
 * `npm run lint`, and CLAUDE.md says plainly that "no automated check stands
 * in for reading those files". That is still true of the request handling —
 * it needs Deno, a JWT and OpenRouter. It does not have to be true of the
 * pure logic, which is why `grounding.ts` is a separate module with no Deno
 * globals in it: the part that decides whether a manager is shown an invented
 * date is exactly the part worth testing.
 *
 * `vitest.config.ts` was widened to `supabase/functions/**​/*.test.ts` to
 * reach this. Nothing else in that tree is imported here.
 */

const PERIOD = { periodStart: '2027-03-01', periodEnd: '2027-03-07' };
const KNOWN = ['Sunnyvale Care', 'Ada Lovelace', 'Bo Diddley', 'Night', 'Ward A'];

const vocab = (prompt: string): Parameters<typeof checkAnnouncementGrounding>[2] => ({
  ...PERIOD,
  prompt,
  known: KNOWN,
});

describe('extractDates', () => {
  it('reads ISO, day-first and month-first forms', () => {
    expect(extractDates('on 2027-03-04 please', 2027)).toEqual(['2027-03-04']);
    expect(extractDates('by 4 March', 2027)).toEqual(['2027-03-04']);
    expect(extractDates('by 4th March 2028', 2027)).toEqual(['2028-03-04']);
    expect(extractDates('on March 4th', 2027)).toEqual(['2027-03-04']);
  });

  it('resolves a bare day and month against the period year', () => {
    expect(extractDates('cover needed 12 December', 2027)).toEqual(['2027-12-12']);
  });

  it('ignores slashed dates, which are ambiguous', () => {
    // 04/03/2027 is 4 March here and 3 April in the US. Reporting either would
    // mean asserting a date the writer did not write.
    expect(extractDates('on 04/03/2027', 2027)).toEqual([]);
  });

  it('ignores an impossible day rather than rolling it over', () => {
    expect(extractDates('on 34 March', 2027)).toEqual([]);
  });

  it('does not read a time as a date', () => {
    expect(extractDates('starts at 09:00 and ends at 17:00', 2027)).toEqual([]);
  });
});

describe('extractNameCandidates', () => {
  it('ignores the first word of a sentence', () => {
    // The whole check rests on this: without it, every "Please check the rota"
    // reports "Please" as an invented name.
    expect(extractNameCandidates('Please check the rota.')).toEqual([]);
  });

  it('finds a capitalised word mid-sentence', () => {
    expect(extractNameCandidates('Cover was arranged by Priya today.')).toEqual([
      'Priya',
    ]);
  });

  it('treats a newline as a sentence break, and a bullet as not a word', () => {
    // Both halves matter: without the newline split, "Mornings" would be
    // mid-sentence and flagged; without stripping the bullet, "Nights" would
    // be words[1] and flagged too.
    expect(extractNameCandidates('- Nights are covered\n- Mornings are not')).toEqual([]);
  });

  it('ignores an all-caps acronym', () => {
    expect(extractNameCandidates('Report it to the NHS line.')).toEqual([]);
  });
});

describe('checkAnnouncementGrounding', () => {
  it('passes a draft whose dates are all inside the period', () => {
    const result = checkAnnouncementGrounding(
      'Cover needed this week',
      'Two shifts on 3 March still need cover. Speak to Ada if you can help.',
      vocab('we need cover this week'),
    );
    expect(result.ungroundedDates).toEqual([]);
    expect(result.suspectNames).toEqual([]);
  });

  it('catches a date from outside the period', () => {
    const result = checkAnnouncementGrounding(
      'Rota update',
      'The new pattern starts on 19 April.',
      vocab('tell the team about the new pattern'),
    );
    expect(result.ungroundedDates).toEqual(['2027-04-19']);
  });

  it('accepts a date the manager supplied, even outside the period', () => {
    // The reason this is not a simple period check. A manager writing "the
    // Christmas rota closes on 12 December" is stating a fact; refusing it
    // would make the feature useless for anything but the current week.
    const result = checkAnnouncementGrounding(
      'Christmas rota',
      'Requests close on 12 December, so send yours before then.',
      vocab('remind everyone the christmas rota closes on 12 December'),
    );
    expect(result.ungroundedDates).toEqual([]);
  });

  it('flags a name nobody on the roster has', () => {
    const result = checkAnnouncementGrounding(
      'Cover',
      'Thanks to Priya for covering Tuesday night.',
      vocab('thank whoever covered'),
    );
    expect(result.suspectNames).toEqual(['Priya']);
  });

  it('does not flag a real staff member, site or shift type', () => {
    const result = checkAnnouncementGrounding(
      'Nights',
      'Ada and Bo are on Night at Ward A this week.',
      vocab('who is on nights'),
    );
    expect(result.suspectNames).toEqual([]);
  });

  it('does not flag a name the manager used in their own prompt', () => {
    const result = checkAnnouncementGrounding(
      'Welcome',
      'Please welcome Priya, who joins us on Monday.',
      vocab('write a welcome for Priya joining on Monday'),
    );
    expect(result.suspectNames).toEqual([]);
  });

  it('does not flag a weekday or a month', () => {
    const result = checkAnnouncementGrounding(
      'Reminder',
      'Shifts change on Tuesday, and again in March.',
      vocab('remind the team'),
    );
    expect(result.suspectNames).toEqual([]);
  });

  it('survives a malformed period rather than hanging on it', () => {
    const result = checkAnnouncementGrounding('T', 'Something on 3 March.', {
      periodStart: 'not-a-date',
      periodEnd: '2027-03-07',
      prompt: '',
      known: [],
    });
    // With no period to compare against, the date is ungrounded — which is the
    // safe direction: it refuses rather than passing a date it cannot check.
    expect(result.ungroundedDates).toEqual(['2027-03-03']);
  });
});
