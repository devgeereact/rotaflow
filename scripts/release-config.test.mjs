import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'));

describe('release.json', () => {
  it('releases from main, the branch that is live', () => {
    // scripts/release.mjs refuses to run on any other branch, so a stale name blocks every release.
    expect(cfg.branch).toBe('main');
  });

  it('only uploads from folders that exist in the repository or are built', () => {
    const built = new Set(['dist']);
    for (const part of cfg.parts) {
      expect(built.has(part.from) || existsSync(join(root, part.from)), part.from).toBe(
        true,
      );
    }
  });

  it('smokes the health route and an unauthenticated API route', () => {
    const paths = cfg.smoke.map((s) => s.path);
    expect(paths).toContain('/api/health');
    expect(cfg.smoke.find((s) => s.path === '/api/me')?.status).toBe(401);
  });
});
