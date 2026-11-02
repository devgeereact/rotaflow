/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

describe('useOnlineStatus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is online when navigator.onLine is undefined, as in the Node prerender', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(
      undefined as unknown as boolean,
    );
    expect(renderHook(() => useOnlineStatus()).result.current).toBe(true);
  });

  it('is offline only when the browser says so', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    expect(renderHook(() => useOnlineStatus()).result.current).toBe(false);
  });
});
