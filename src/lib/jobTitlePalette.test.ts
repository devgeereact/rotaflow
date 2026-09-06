import { describe, expect, it } from 'vitest';
import {
  JOB_TITLE_FALLBACK,
  JOB_TITLE_PALETTE,
  JOB_TITLE_PALETTE_SIZE,
  availableSwatches,
  jobTitleAccentClass,
  jobTitleBadgeClass,
  jobTitleCode,
  jobTitleSwatch,
  nextFreeSwatch,
  normaliseJobTitleName,
} from '@/lib/jobTitlePalette';

describe('the palette itself', () => {
  it('has twelve entries with unique ids and unique hexes', () => {
    expect(JOB_TITLE_PALETTE).toHaveLength(JOB_TITLE_PALETTE_SIZE);
    expect(new Set(JOB_TITLE_PALETTE.map((s) => s.id)).size).toBe(JOB_TITLE_PALETTE_SIZE);
    expect(new Set(JOB_TITLE_PALETTE.map((s) => s.hex)).size).toBe(
      JOB_TITLE_PALETTE_SIZE,
    );
  });

  it('writes every Tailwind class out in full', () => {
    // Tailwind's content scan cannot see a concatenated class, so a swatch
    // built by string interpolation renders with no colour at all in a
    // production build and looks perfect in dev.
    for (const swatch of JOB_TITLE_PALETTE) {
      expect(swatch.badgeClass).toContain(`bg-role-${swatch.id}-wash`);
      expect(swatch.badgeClass).toContain(`dark:bg-role-${swatch.id}-deep`);
      expect(swatch.accentClass).toBe(`bg-role-${swatch.id}`);
    }
  });

  it('is a separate family from the shift palette', async () => {
    // Two colour systems on one chip with one legend is unreadable, so the
    // two must not share tokens.
    const { SHIFT_PALETTE } = await import('@/lib/shiftPalette');
    const shiftHexes = new Set<string>(SHIFT_PALETTE.map((s) => s.hex));
    for (const swatch of JOB_TITLE_PALETTE) {
      expect(shiftHexes.has(swatch.hex)).toBe(false);
    }
  });
});

describe('resolving a colour', () => {
  it('returns the neutral fallback for no colour and for an unknown one', () => {
    expect(jobTitleBadgeClass(null)).toBe(JOB_TITLE_FALLBACK.badgeClass);
    expect(jobTitleBadgeClass('retired-swatch')).toBe(JOB_TITLE_FALLBACK.badgeClass);
    expect(jobTitleAccentClass(undefined)).toBe(JOB_TITLE_FALLBACK.accentClass);
    expect(jobTitleSwatch('retired-swatch')).toBeNull();
  });

  it('never borrows another occupation swatch as a fallback', () => {
    const fallback = jobTitleBadgeClass('nonsense');
    expect(JOB_TITLE_PALETTE.some((s) => s.badgeClass === fallback)).toBe(false);
  });
});

describe('name normalisation', () => {
  it('folds case and collapses whitespace', () => {
    expect(normaliseJobTitleName('Senior Carer')).toBe('senior carer');
    expect(normaliseJobTitleName('  senior   CARER  ')).toBe('senior carer');
  });

  it('treats every case and spacing variant as the same title', () => {
    const variants = ['Senior Carer', 'senior carer', 'Senior  Carer ', 'SENIOR CARER'];
    expect(new Set(variants.map(normaliseJobTitleName)).size).toBe(1);
  });

  it('keeps genuinely different occupations apart', () => {
    // "Snr Carer" is an abbreviation, not a spelling variant, and merging it
    // is a decision for the organisation rather than for a normaliser.
    expect(normaliseJobTitleName('Snr Carer')).not.toBe(
      normaliseJobTitleName('Senior Carer'),
    );
  });
});

describe('short codes', () => {
  it('uses initials for a multi-word title and two letters for one word', () => {
    expect(jobTitleCode('Senior Carer')).toBe('SC');
    expect(jobTitleCode('Nurse')).toBe('NU');
    expect(jobTitleCode('Registered  Mental  Health Nurse')).toBe('RM');
  });

  it('degrades rather than throwing on an empty name', () => {
    expect(jobTitleCode('   ')).toBe('--');
  });
});

describe('allocating colours', () => {
  it('offers only the free swatches', () => {
    const free = availableSwatches(['indigo', 'sky']);
    expect(free).toHaveLength(JOB_TITLE_PALETTE_SIZE - 2);
    expect(free.map((s) => s.id)).not.toContain('indigo');
  });

  it('lets a title keep the colour it already holds while editing it', () => {
    const free = availableSwatches(['indigo', 'sky'], 'indigo');
    expect(free.map((s) => s.id)).toContain('indigo');
    expect(free.map((s) => s.id)).not.toContain('sky');
  });

  it('returns null rather than reusing a swatch once the palette is exhausted', () => {
    // Two occupations sharing a colour is worse than a blocked form: nothing
    // on screen says the colour has stopped meaning one thing.
    const all = JOB_TITLE_PALETTE.map((s) => s.id);
    expect(nextFreeSwatch(all)).toBeNull();
    expect(availableSwatches(all)).toHaveLength(0);
  });

  it('suggests the next free swatch in palette order', () => {
    expect(nextFreeSwatch([])?.id).toBe(JOB_TITLE_PALETTE[0]?.id);
    expect(nextFreeSwatch([JOB_TITLE_PALETTE[0]!.id])?.id).toBe(JOB_TITLE_PALETTE[1]?.id);
  });
});
