import { describe, expect, it } from 'vitest';
import { shouldHydrate } from '@/lib/prerender';
import { resolvePageMetadata } from '@/lib/pageMetadata';

describe('shouldHydrate', () => {
  it('hydrates markup prerendered for the path being visited', () => {
    expect(shouldHydrate('/features', '/features')).toBe(true);
    expect(shouldHydrate('/', '/')).toBe(true);
  });

  it('ignores a trailing slash on either side', () => {
    expect(shouldHydrate('/features', '/features/')).toBe(true);
    expect(shouldHydrate('/legal/privacy/', '/legal/privacy')).toBe(true);
  });

  it('renders fresh when there is no marker, as in the app shell and the 404 page', () => {
    expect(shouldHydrate(undefined, '/app/dashboard')).toBe(false);
    expect(shouldHydrate('', '/anything')).toBe(false);
  });

  it('renders fresh when the markup was built for another path', () => {
    // The home page's markup must never be hydrated as /app/dashboard.
    expect(shouldHydrate('/', '/app/dashboard')).toBe(false);
    expect(shouldHydrate('/features', '/pricing')).toBe(false);
  });
});

describe('resolvePageMetadata', () => {
  it('uses the public route catalogue and appends the brand', () => {
    const meta = resolvePageMetadata('/pricing', 'https://rotaflow.space');
    expect(meta.fullTitle).toBe('Pricing · RotaFlow');
    expect(meta.canonical).toBe('https://rotaflow.space/pricing');
    expect(meta.description.length).toBeGreaterThan(20);
  });

  it('keeps one canonical per page, with a slash only on the root', () => {
    expect(resolvePageMetadata('/', 'https://rotaflow.space/').canonical).toBe(
      'https://rotaflow.space/',
    );
    expect(resolvePageMetadata('/features/', 'https://rotaflow.space').canonical).toBe(
      'https://rotaflow.space/features',
    );
  });

  it('lets a page override its title', () => {
    expect(
      resolvePageMetadata('/nowhere', 'https://rotaflow.space', {
        title: 'Page not found',
      }).fullTitle,
    ).toBe('Page not found · RotaFlow');
  });
});
