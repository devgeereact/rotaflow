import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The JSON-LD block in `index.html` against the marketing honesty rule.
 *
 * The block is deliberately thin: who publishes the site and what the product
 * is. Search engines reward `aggregateRating` and `review` with stars in the
 * results, which makes them the first thing someone adds to "improve SEO", and
 * there are no reviews to cite (docs/UX-SPEC.md, the CAP Code section). A price
 * in `offers` would be a second copy of `PLANS` that nothing reconciles.
 *
 * A malformed block is silently ignored by every crawler, so the parse is
 * asserted here rather than discovered in a search console months later.
 */

const FORBIDDEN_KEYS = ['aggregateRating', 'review', 'offers', 'award'];

function readStructuredData(): unknown {
  const html = readFileSync('index.html', 'utf8');
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u);
  if (!match?.[1]) throw new Error('index.html has no JSON-LD block');
  return JSON.parse(match[1]) as unknown;
}

function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describe('index.html structured data', () => {
  it('parses as JSON', () => {
    expect(() => readStructuredData()).not.toThrow();
  });

  it('names the organisation and the product', () => {
    const data = readStructuredData() as { '@graph': { '@type': string }[] };
    const types = data['@graph'].map((node) => node['@type']);
    expect(types).toEqual(
      expect.arrayContaining(['Organization', 'SoftwareApplication']),
    );
  });

  it('claims no ratings, reviews, awards or prices', () => {
    const keys = collectKeys(readStructuredData());
    for (const key of FORBIDDEN_KEYS) {
      expect(keys.has(key), `${key} must not appear in the JSON-LD`).toBe(false);
    }
  });
});
