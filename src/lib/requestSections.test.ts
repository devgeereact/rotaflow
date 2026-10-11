import { describe, expect, it } from 'vitest';
import { REQUEST_SECTIONS, isRequestPath } from '@/lib/requestSections';

describe('REQUEST_SECTIONS', () => {
  it('lists Leave, Swaps and Overtime in that order', () => {
    expect(REQUEST_SECTIONS.map((s) => s.label)).toEqual(['Leave', 'Swaps', 'Overtime']);
  });
});

describe('isRequestPath', () => {
  it('matches each request screen', () => {
    expect(isRequestPath('/app/leave')).toBe(true);
    expect(isRequestPath('/app/swaps')).toBe(true);
    expect(isRequestPath('/app/overtime')).toBe(true);
  });

  it('does not match a screen that only shares a prefix', () => {
    expect(isRequestPath('/app/leaves')).toBe(false);
    expect(isRequestPath('/app/open-shifts')).toBe(false);
    expect(isRequestPath('/app/dashboard')).toBe(false);
  });
});
