/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react';
import { useRef, type JSX } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMarketingMotion } from '@/components/marketing/motion/useMarketingMotion';

/**
 * GSAP and Lenis may only ever load for a visitor who has not asked for less
 * movement. That is the whole safety argument for having them at all
 * (docs/DESIGN-SYSTEM.md §4): under reduced motion, and in every Playwright
 * run, the module must never be fetched, so nothing it does can hide copy.
 *
 * The module is mocked so the test observes the import itself, not GSAP.
 */

const startMarketingMotion = vi.hoisted(() => vi.fn(() => vi.fn()));

vi.mock('@/components/marketing/motion/marketingMotion', () => ({
  startMarketingMotion,
}));

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('no-preference') ? !reduce : reduce,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('scrollTo', vi.fn());
}

function Page(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useMarketingMotion(ref);
  return <div ref={ref}>page</div>;
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Page />
    </MemoryRouter>,
  );
}

/** Lets the requestAnimationFrame and the dynamic import settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('useMarketingMotion', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    startMarketingMotion.mockClear();
  });

  it('never loads the motion module under reduced motion', async () => {
    stubReducedMotion(true);
    renderPage();
    await settle();
    expect(startMarketingMotion).not.toHaveBeenCalled();
  });

  it('loads it after first paint when motion is allowed, and stops it on unmount', async () => {
    stubReducedMotion(false);
    const { unmount } = renderPage();
    await settle();
    expect(startMarketingMotion).toHaveBeenCalledTimes(1);

    const stop = startMarketingMotion.mock.results[0]!.value as ReturnType<typeof vi.fn>;
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
