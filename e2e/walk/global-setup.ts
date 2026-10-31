import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { authFile, ROLES, ROOT, signIn, type Role } from './support';

/** A saved session younger than this is reused: Clerk's development instance limits how often a code may be asked for. */
const REUSE_MS = 6 * 60 * 60 * 1000;

/**
 * Signs each walk role in once through Clerk (development instance, test-mode addresses) and saves the session, so each spec
 * starts signed in. The Clerk users must exist on the development instance (docs/AUDIT.md, "Local-live walk", set-up).
 * WALK_FRESH_AUTH=1 signs everyone in again.
 *
 * Every run starts from the same data: the local walk database is recreated and seeded (`scripts/walk.sh db`) first,
 * unless WALK_KEEP_DB=1. The saved sessions survive it: the API links each person again by their verified email.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env['WALK_KEEP_DB'] !== '1') {
    execFileSync(path.join(ROOT, 'scripts', 'walk.sh'), ['db'], { stdio: 'inherit' });
  }
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:5042';
  mkdirSync(path.dirname(authFile('owner')), { recursive: true });
  const browser = await chromium.launch();
  for (const role of [...ROLES, 'staff2'] as (Role | 'staff2')[]) {
    const file = authFile(role);
    if (
      process.env['WALK_FRESH_AUTH'] !== '1' &&
      existsSync(file) &&
      Date.now() - statSync(file).mtimeMs < REUSE_MS
    ) {
      continue;
    }
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    try {
      await signIn(page, role);
    } catch (e) {
      await page.screenshot({
        path: path.join(ROOT, 'test-results', `walk-signin-${role}.png`),
      });
      throw new Error(
        `sign-in as ${role} failed at ${page.url()}: ${(e as Error).message}`,
      );
    }
    // Decline optional storage once (kept in localStorage), so the consent banner never covers a control.
    const reject = page.getByRole('button', { name: 'Reject all' });
    if (await reject.isVisible().catch(() => false)) await reject.click();
    await ctx.storageState({ path: file });
    await ctx.close();
  }
  await browser.close();
}
