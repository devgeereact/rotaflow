// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollIntervalFor, useRealtimeRefresh } from './useRealtimeRefresh';

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

describe('pollIntervalFor', () => {
  it('uses the fastest table', () => {
    expect(pollIntervalFor(['locations', 'clock_events'])).toBe(15_000);
    expect(pollIntervalFor(['shift_types'])).toBe(120_000);
  });

  it('has a sensible default for no tables', () => {
    expect(pollIntervalFor([])).toBe(60_000);
  });
});

describe('useRealtimeRefresh (polling)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const options = (
    onChange: () => void,
    extra: { enabled?: boolean } = {},
  ): Parameters<typeof useRealtimeRefresh>[0] => ({
    tables: ['shifts'],
    scope: { column: 'org_id', value: 'org-1' },
    onChange,
    ...extra,
  });

  it('does not refresh on mount, then refreshes every interval', () => {
    const onChange = vi.fn();
    renderHook(() => useRealtimeRefresh(options(onChange)));
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('reports itself connected while polling and not when disabled', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useRealtimeRefresh(options(vi.fn(), { enabled })),
      { initialProps: { enabled: true } },
    );
    expect(result.current.connected).toBe(true);
    rerender({ enabled: false });
    expect(result.current.connected).toBe(false);
  });

  it('is off without a scope value', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useRealtimeRefresh({
        tables: ['shifts'],
        scope: { column: 'org_id', value: null },
        onChange,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(false);
  });

  it('skips polls while the tab is hidden or the browser is offline', () => {
    const onChange = vi.fn();
    renderHook(() => useRealtimeRefresh(options(onChange)));
    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onChange).not.toHaveBeenCalled();
    setVisibility('visible');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refreshes once when the tab comes back, even if two events arrive together', () => {
    const onChange = vi.fn();
    renderHook(() => useRealtimeRefresh(options(onChange)));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(400);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on becoming visible if it is not visible', () => {
    const onChange = vi.fn();
    renderHook(() => useRealtimeRefresh(options(onChange)));
    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(400);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops when unmounted', () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useRealtimeRefresh(options(onChange)));
    unmount();
    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(400);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses the latest onChange without restarting the timer', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useRealtimeRefresh(options(cb)), {
      initialProps: { cb: first },
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender({ cb: second });
    act(() => {
      vi.advanceTimersByTime(10_000);
    }); // 20 s since mount: the original timer is still running
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
