#!/usr/bin/env node
/**
 * Claude Code Stop hook: do not finish with code changed and docs untouched.
 *
 * The in-session half of `scripts/check-docs-impact.mjs` (the CI half), and
 * the same rule: GEE OS LOOP step 8 (Synchronise) and CHANGE-SAFETY step 9.
 * CI catches it at the pull request; this catches it while the agent still
 * has the context to fix it cheaply.
 *
 * Contract (Claude Code hooks reference, code.claude.com/docs/en/hooks):
 *   - stdin is JSON; `stop_hook_active` is true when Claude is already
 *     continuing because a Stop hook blocked. We then ALLOW, always, so this
 *     hook blocks at most once per stop and can never loop.
 *   - to block, print `{"decision":"block","reason":"..."}` and exit 0.
 *   - to allow, print nothing and exit 0.
 *
 * It must never break a session. Any error, timeout or missing git state
 * allows the stop; the CI gate is the backstop.
 *
 * Escape hatch: a line `Docs: no impact (reason)` in `.agent/CURRENT-TASK.md`
 * (the gitignored task contract) records that the agent looked and nothing
 * needed to change.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ALWAYS_CONSIDER,
  formatOwners,
  isCodePath,
  isDocPath,
  noImpactReason,
  owningDocs,
} from '../check-docs-impact.mjs';

/**
 * The decision, with no I/O.
 *
 * @param {{ input: Record<string, unknown>, files: string[], taskContract: string }} args
 * @returns {{ block: boolean, reason?: string }}
 */
export function decideStop({ input, files, taskContract }) {
  if (input?.stop_hook_active === true) return { block: false };

  const changed = files.filter((f) => !f.startsWith('.claude/worktrees/'));
  const code = changed.filter(isCodePath);
  if (code.length === 0) return { block: false };
  if (changed.some(isDocPath)) return { block: false };
  if (noImpactReason(taskContract)) return { block: false };

  const reason = [
    `Docs sync (GEE OS LOOP step 8): ${code.length} behaviour-bearing file(s) changed on this branch and no documentation did.`,
    'Likely owners:',
    ...formatOwners(owningDocs(code)),
    `  and, if behaviour changed: ${ALWAYS_CONSIDER.join(', ')}`,
    'Update the owning doc (see docs/README.md), or add `Docs: no impact (reason)` to .agent/CURRENT-TASK.md and say so in your report.',
  ].join('\n');
  return { block: true, reason };
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1500,
  });
}

/** Committed-on-branch plus uncommitted (staged, unstaged, untracked). */
export function changedFiles(cwd) {
  const files = new Set();
  try {
    const base = git(cwd, ['merge-base', 'HEAD', 'origin/main']).trim();
    for (const f of git(cwd, ['diff', '--name-only', base]).split('\n'))
      if (f) files.add(f);
  } catch {
    // No origin/main (fresh clone, detached CI checkout): uncommitted only.
  }
  for (const line of git(cwd, ['status', '--porcelain']).split('\n')) {
    if (line.length < 4) continue;
    const path = line.slice(3);
    // Renames are `old -> new`; the new path is the one that exists.
    files.add(path.includes(' -> ') ? path.split(' -> ')[1] : path);
  }
  return [...files].map((f) => f.replace(/^"|"$/gu, ''));
}

function main() {
  let input = {};
  try {
    const raw = readFileSync(0, 'utf8');
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return; // Unreadable input: allow.
  }
  if (input.stop_hook_active === true) return;

  const cwd = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const contractPath = join(cwd, '.agent', 'CURRENT-TASK.md');
  const taskContract = existsSync(contractPath) ? readFileSync(contractPath, 'utf8') : '';

  const decision = decideStop({ input, files: changedFiles(cwd), taskContract });
  if (decision.block) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: decision.reason }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    // Never break a session over a docs reminder.
  }
  process.exit(0);
}
