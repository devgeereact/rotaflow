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
import { createHash } from 'node:crypto';
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
  let written = false;
  try {
    await run('write', composed);
    written = true;
    await run('move');
  } catch (e) {
    // After a successful write the new file may already be live: put the old one back. Before it, only the half-written file exists.
    if (written) await run('restore');
    else {
      try {
        await run('cleanup');
      } catch {
        // the original error below is the one that matters
      }
    }
    throw e;
  }
  let good = false;
  try {
    good = await smoke();
  } catch {
    good = false;
  }
  if (!good) {
    await run('restore');
    return { ok: false, changed: false, rolledBack: true };
  }
  return { ok: true, changed: true };
}

/**
 * The checks a release makes (release.json "smoke"). Never throws: a network error is retried once, then counts as a failure, so
 * the caller rolls back instead of crashing with a half-applied file. Each request has a time limit.
 */
export function makeSmoke({
  base,
  checks,
  fetchImpl = fetch,
  timeoutMs = 15000,
  log = () => undefined,
}) {
  const once = async (s) => {
    const res = await fetchImpl(base + s.path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = s.contains ? await res.text() : '';
    if (res.status !== s.status || (s.contains && !body.includes(s.contains))) {
      log(
        `smoke failed: ${s.path} answered ${res.status}${s.contains && !body.includes(s.contains) ? ` without "${s.contains}"` : ''}`,
      );
      return false;
    }
    return true;
  };
  return async () => {
    for (const s of checks) {
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
        try {
          ok = await once(s);
          if (!ok) break; // a wrong answer is an answer: do not retry it
        } catch (e) {
          log(`smoke error on ${s.path}: ${e.message}`);
        }
      }
      if (!ok) return false;
    }
    return true;
  };
}

// ---- command line (not run when imported by the tests) -----------------------------------------------------------------------

/**
 * The real server steps, as remote shell commands. `exec` is injectable so the command strings are tested (they were not, and one of them
 * had a tilde after an equals sign, which a shell does not expand). Every step that replaces the live file does it with a write beside
 * it and one `mv`, so the origin lock is never absent, even for an instant.
 */
export function sshRunner(host, docroot, exec = execFileSync) {
  if (!docroot)
    throw new Error(
      'no document root: release.json has no "dist" part to say where the site lives',
    );
  const live = `~/${docroot}/.htaccess`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const backup = `~/backups/rotaflow/htaccess/htaccess.${stamp}`;
  const ssh = (cmd, input) =>
    exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', host, cmd], {
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
        case 'write': {
          // --reference as its own word: a tilde only expands at the start of a word. sha256sum proves what arrived is what was sent.
          const out = ssh(
            `cat > ${live}.new && chmod --reference ${live} ${live}.new && sha256sum ${live}.new`,
            arg,
          );
          const sent = createHash('sha256').update(arg).digest('hex');
          if (String(out).trim().split(/\s+/)[0] !== sent)
            throw new Error(
              'the uploaded file does not match what was sent (checksum differs)',
            );
          return out;
        }
        case 'move':
          return ssh(`mv ${live}.new ${live}`);
        case 'cleanup':
          return ssh(`rm -f ${live}.new ${live}.restore`);
        case 'restore':
          return ssh(
            `cp -p ${backup} ${live}.restore && mv ${live}.restore ${live} && rm -f ${live}.new`,
          );
        default:
          throw new Error(`unknown step ${step}`);
      }
    },
  };
}

/** True when the two files have the same lines but are not byte-identical (spaces, line endings, a final newline). */
export function whitespaceOnly(composed, live) {
  const norm = (s) =>
    s
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n+$/, '');
  return composed !== live && norm(composed) === norm(live);
}

/** Options per command; anything else is a mistake worth stopping for. */
export function parseArgs(cmd, rest) {
  const allowed = { compose: ['--out='], diff: [], push: ['--go'] }[cmd] ?? [];
  const out = { out: undefined, go: false };
  for (const a of rest) {
    if (allowed.includes('--go') && a === '--go') out.go = true;
    else if (allowed.includes('--out=') && a.startsWith('--out=')) out.out = a.slice(6);
    else throw new Error(`unknown option ${a}`);
  }
  return out;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'));
  const docroot = cfg.parts.find((p) => p.from === 'dist')?.to;
  const composed = composeHtaccess(
    readFileSync(join(root, '.htaccess'), 'utf8'),
    readFileSync(join(root, 'scripts/htaccess/origin-lock.conf'), 'utf8'),
  );
  if (!['compose', 'diff', 'push'].includes(cmd))
    throw new Error('usage: htaccess.mjs compose [--out=FILE] | diff | push [--go]');
  const opts = parseArgs(cmd, rest);

  if (cmd === 'compose') {
    if (opts.out) writeFileSync(opts.out, composed);
    else process.stdout.write(composed);
    return;
  }
  const srv = sshRunner(cfg.host, docroot);
  const liveText = srv.run('read');
  const d = driftLines(composed, liveText);
  console.log(
    `live ${cfg.host}:~/${docroot}/.htaccess differs from the composed file by ${d.missingFromLive.length} line(s) to add and ${d.extraInLive.length} to remove`,
  );
  for (const l of d.missingFromLive) console.log(`  + ${l}`);
  for (const l of d.extraInLive) console.log(`  - ${l}`);
  if (whitespaceOnly(composed, liveText))
    console.log(
      '  (the lines are identical; the files differ only in whitespace or line endings, and push --go would still rewrite it)',
    );
  if (cmd === 'diff') return;

  if (!opts.go) {
    console.log(
      `\nDry run. With --go: back up to ${cfg.host}:${srv.backup}, write ${docroot}/.htaccess.new, move it into place, run the ${cfg.smoke.length} smoke checks from release.json against ${cfg.url}, and restore the backup if any fail (or if the check cannot run).`,
    );
    return;
  }
  const smoke = makeSmoke({
    base: cfg.url,
    checks: cfg.smoke,
    log: (m) => console.error(m),
  });
  let r;
  try {
    r = await pushHtaccess({ composed, run: srv.run, smoke });
  } catch (e) {
    console.error(`push failed: ${e.message}`);
    console.error(
      `The old file is at ${cfg.host}:${srv.backup}. To put it back by hand: ssh ${cfg.host} 'cp -p ${srv.backup} ~/${docroot}/.htaccess'`,
    );
    process.exit(1);
  }
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
