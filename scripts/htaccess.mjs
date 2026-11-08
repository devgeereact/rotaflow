#!/usr/bin/env node
/**
 * The live web-root .htaccess, composed and shipped by a command instead of by hand.
 *
 * The live file is NOT the repository file: it is the Cloudflare origin-lock block (scripts/htaccess/origin-lock.conf, copied verbatim
 * from the live file) followed by the repository's .htaccess. scripts/release.mjs never ships the root .htaccess on purpose (shipping the
 * repo file alone would silently remove the lock), so a change to it (the 2 Nov 2026 banner hardening was one) used to need a hand edit.
 *
 *   node scripts/htaccess.mjs compose [--out=FILE]   print (or write) the file that should be live
 *   node scripts/htaccess.mjs diff                   compare it with the live file (reads the server, writes nothing)
 *   node scripts/htaccess.mjs push [--go]            show the plan; with --go: back up, write beside, move into place, smoke-check,
 *                                                    and put the old file back if the site does not answer
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Lock block first, repository file after it. Safe to run over its own output. */
export function composeHtaccess(repoText, lockText) {
  if (
    !/# === BEGIN Cloudflare-origin-lock/.test(lockText) ||
    !/# === END Cloudflare-origin-lock ===/.test(lockText)
  ) {
    throw new Error(
      'the origin lock block is missing its BEGIN/END markers; refusing to compose',
    );
  }
  return repoText.startsWith(lockText) ? repoText : lockText + repoText;
}

/** Non-blank lines present on one side and not the other (counted, so a repeated line is not hidden). */
export function driftLines(composed, live) {
  const tally = (t) => {
    const m = new Map();
    for (const l of t.split('\n')) if (l.trim() !== '') m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const c = tally(composed);
  const l = tally(live);
  const minus = (a, b) =>
    [...a].flatMap(([line, n]) => Array(Math.max(0, n - (b.get(line) ?? 0))).fill(line));
  return { missingFromLive: minus(c, l), extraInLive: minus(l, c) };
}

/**
 * Replace the live file safely. `run(step, arg)` does one named step on the server (read, backup, write, move, restore) and `smoke()`
 * answers whether the site still serves. Nothing is written until the backup exists; a failed move or a failed smoke check puts the old
 * file back.
 */
export async function pushHtaccess({ composed, run, smoke }) {
  const live = await run('read');
  if (live === composed) return { ok: true, changed: false };
  await run('backup');
  let moved = false;
  try {
    await run('write', composed);
    moved = true;
    await run('move');
  } catch (e) {
    if (moved) await run('restore');
    throw e;
  }
  if (!(await smoke())) {
    await run('restore');
    return { ok: false, changed: false, rolledBack: true };
  }
  return { ok: true, changed: true };
}

// ---- command line (not run when imported by the tests) -----------------------------------------------------------------------

function sshRunner(host, docroot) {
  const live = `~/${docroot}/.htaccess`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const backup = `~/backups/rotaflow/htaccess/htaccess.${stamp}`;
  const ssh = (cmd, input) =>
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', host, cmd], {
      input,
      encoding: 'utf8',
    });
  return {
    backup,
    run(step, arg) {
      switch (step) {
        case 'read':
          return ssh(`cat ${live}`);
        case 'backup':
          return ssh(
            `mkdir -p ~/backups/rotaflow/htaccess && cp -p ${live} ${backup} && chmod 600 ${backup}`,
          );
        case 'write':
          return ssh(`cat > ${live}.new && chmod --reference=${live} ${live}.new`, arg);
        case 'move':
          return ssh(`mv ${live}.new ${live}`);
        case 'restore':
          return ssh(`cp -p ${backup} ${live} && rm -f ${live}.new`);
        default:
          throw new Error(`unknown step ${step}`);
      }
    },
  };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'));
  const docroot = cfg.parts.find((p) => p.from === 'dist')?.to;
  const composed = composeHtaccess(
    readFileSync(join(root, '.htaccess'), 'utf8'),
    readFileSync(join(root, 'scripts/htaccess/origin-lock.conf'), 'utf8'),
  );
  const known = new Set(['--go']);
  for (const a of rest)
    if (!known.has(a) && !a.startsWith('--out=')) throw new Error(`unknown option ${a}`);

  if (cmd === 'compose') {
    const out = rest.find((a) => a.startsWith('--out='))?.slice(6);
    if (out) writeFileSync(out, composed);
    else process.stdout.write(composed);
    return;
  }
  if (cmd !== 'diff' && cmd !== 'push')
    throw new Error('usage: htaccess.mjs compose [--out=FILE] | diff | push [--go]');

  const srv = sshRunner(cfg.host, docroot);
  const liveText = srv.run('read');
  const d = driftLines(composed, liveText);
  console.log(
    `live ${cfg.host}:~/${docroot}/.htaccess differs from the composed file by ${d.missingFromLive.length} line(s) to add and ${d.extraInLive.length} to remove`,
  );
  for (const l of d.missingFromLive) console.log(`  + ${l}`);
  for (const l of d.extraInLive) console.log(`  - ${l}`);
  if (cmd === 'diff') return;

  if (!rest.includes('--go')) {
    console.log(
      `\nDry run. With --go: back up to ${cfg.host}:${srv.backup}, write ${docroot}/.htaccess.new, move it into place, check ${cfg.url}/ and /api/health, and restore the backup if either fails.`,
    );
    return;
  }
  // The same checks a release makes (release.json "smoke"): the home page, the API health route, an unauthenticated API call,
  // a deep SPA route (proves the fallback survived) and a missing page (proves 404s still 404).
  const smoke = async () => {
    for (const s of cfg.smoke) {
      const res = await fetch(cfg.url + s.path, { redirect: 'manual' });
      const body = s.contains ? await res.text() : '';
      if (res.status !== s.status || (s.contains && !body.includes(s.contains))) {
        console.error(
          `smoke failed: ${s.path} answered ${res.status}${s.contains && !body.includes(s.contains) ? ` without "${s.contains}"` : ''}`,
        );
        return false;
      }
    }
    return true;
  };
  const r = await pushHtaccess({ composed, run: srv.run, smoke });
  console.log(
    r.changed
      ? `pushed; old file kept at ${srv.backup}`
      : r.rolledBack
        ? 'smoke check failed; the old file was restored'
        : 'already up to date',
  );
  if (!r.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`htaccess: ${e.message}`);
    process.exit(
      e.message.startsWith('unknown option') || e.message.startsWith('usage') ? 2 : 1,
    );
  });
}
