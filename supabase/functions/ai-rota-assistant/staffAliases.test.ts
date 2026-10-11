import { describe, expect, it } from 'vitest';
import { buildStaffAliases, type AliasableStaff } from './staffAliases';

/**
 * Plan S3: a captured OpenRouter request body must hold no staff names. The
 * request handling needs Deno, a JWT and OpenRouter, so what is tested here is
 * the pure mapping `index.ts` builds the context and reads the reply with.
 */

const ADA: AliasableStaff = { id: 'c-ada', first_name: 'Ada', last_name: 'Lovelace' };
const BO: AliasableStaff = { id: 'a-bo', first_name: 'Bo', last_name: 'Diddley' };
const JO_1: AliasableStaff = { id: 'b-jo', first_name: 'Jo', last_name: 'March' };
const JO_2: AliasableStaff = { id: 'd-jo', first_name: 'Jo', last_name: 'Brand' };
const WILL: AliasableStaff = { id: 'e-will', first_name: 'Will', last_name: 'Turner' };

describe('buildStaffAliases', () => {
  it('assigns S1, S2... in staff-id order, whatever order the query returned', () => {
    const one = buildStaffAliases([ADA, BO, JO_1]);
    const two = buildStaffAliases([JO_1, ADA, BO]);
    for (const aliases of [one, two]) {
      expect(aliases.aliasFor('a-bo')).toBe('S1');
      expect(aliases.aliasFor('b-jo')).toBe('S2');
      expect(aliases.aliasFor('c-ada')).toBe('S3');
    }
  });

  it('maps an alias back to the real staff profile id, and nothing else', () => {
    const aliases = buildStaffAliases([ADA, BO]);
    expect(aliases.idFor('S2')).toBe('c-ada');
    expect(aliases.idFor(' S1 ')).toBe('a-bo');
    expect(aliases.idFor('S3')).toBeUndefined();
    // A real UUID the model could not have seen is not accepted as an alias.
    expect(aliases.idFor('c-ada')).toBeUndefined();
    expect(aliases.aliasFor('nobody')).toBeUndefined();
  });

  it('builds a context that serialises with no names in it', () => {
    const staff = [ADA, BO, JO_1, JO_2];
    const aliases = buildStaffAliases(staff);
    // Mirrors the shape `index.ts` sends.
    const context = {
      staff: staff.map((s) => ({ id: aliases.aliasFor(s.id), jobTitle: 'Carer' })),
      existingShifts: [{ staffProfileId: aliases.aliasFor(ADA.id) }],
      approvedLeave: [{ staffProfileId: aliases.aliasFor(BO.id) }],
    };
    const body = JSON.stringify({
      context,
      prompt: aliases.maskPrompt('Give Ada Lovelace and Bo the weekend.'),
    });
    for (const s of staff) {
      expect(body).not.toContain(s.first_name);
      expect(body).not.toContain(s.last_name);
      expect(body).not.toContain(s.id);
    }
  });

  describe('maskPrompt', () => {
    const aliases = buildStaffAliases([ADA, BO, JO_1, JO_2, WILL]);

    it('replaces full names and first names only one person has', () => {
      expect(aliases.maskPrompt('Put Ada Lovelace on nights, and Bo on earlies.')).toBe(
        'Put S3 on nights, and S1 on earlies.',
      );
    });

    it('leaves a first name two people share as typed', () => {
      expect(aliases.maskPrompt('Jo needs Friday off. Jo March is fine.')).toBe(
        'Jo needs Friday off. S2 is fine.',
      );
    });

    it('is whole-word and case-sensitive, so ordinary words survive', () => {
      expect(aliases.maskPrompt('We will need Bob and Adam, and Will on Sunday.')).toBe(
        'We will need Bob and Adam, and S5 on Sunday.',
      );
    });
  });

  describe('restoreNames', () => {
    const aliases = buildStaffAliases([ADA, BO]);

    it('turns aliases in model prose back into full names', () => {
      expect(aliases.restoreNames('S2 covers Friday; S1 has the weekend.')).toBe(
        'Ada Lovelace covers Friday; Bo Diddley has the weekend.',
      );
    });

    it('leaves an alias that is not ours, and look-alike words, alone', () => {
      expect(
        aliases.restoreNames('S9 and S12 are not real; SS1 and S1x are words.'),
      ).toBe('S9 and S12 are not real; SS1 and S1x are words.');
    });
  });
});
