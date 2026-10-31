#!/usr/bin/env node
/*
 * Release over SSH to the cPanel host: `pnpm release` (dry run) then `pnpm release --go`.
 * Settings: release.json at the project root (no secrets in it). Kit rule: no FTP, no GitHub Actions deploys.
 *
 *   1. Preflight: on main, clean, equal to origin/main.
 *   2. Checks and build: the "checks" commands, then "build" (skip checks with --skip-checks, emergencies only).
 *   3. Plan: a checksum rsync dry run per part. Nothing is deleted on the server, ever, and the "protect" names
 *      (config.php, .htaccess, .env*, dumps, error_log) are never sent, unless a part lists one in "allow"
 *      (only for a file the build makes, such as an app sub-folder's .htaccess). Without --go it stops here.
 *   4. Snapshot: every server file about to change is copied to ~/backups/<project>/releases/<utc>/ first,
 *      with RELEASE.json (commit, parts, new files). The newest 3 snapshots are kept.
 *   5. Upload: each part in order; the entry files ("last") go after everything else.
 *   6. Smoke: each "smoke" URL must answer its status. Any failure restores the snapshot automatically.
 *
 * Options: --go, --skip-checks, --rollback (restore the newest snapshot), --list (show snapshots),
 *   --verify (steps 2 and the upload guard only, on uncommitted work, before you commit or push; never contacts the host),
 *   --config=FILE (another settings file, e.g. release.coming-soon.json for the coming-soon page).
 * host "local" runs everything against $HOME on this computer (used by the kit's own test).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const argv = process.argv.slice(2);
const known = new Set(['--go', '--skip-checks', '--rollback', '--list', '--verify']);
for (const a of argv) if (!known.has(a) && !a.startsWith('--config=')) fail(`unknown option ${a}. Options: ${[...known].join(', ')}, --config=FILE`);
const go = argv.includes('--go');
const verify = argv.includes('--verify');
if (verify && (go || argv.includes('--rollback') || argv.includes('--list') || argv.includes('--skip-checks'))) fail('--verify runs the checks and build only; use it on its own.');
const KEEP = 3;
const PROTECT = ['config.php', '.htaccess', '.user.ini', 'php.ini', '.env', '.env.*', '*.sql', '*.sql.gz', '*.pem', '*.key', 'error_log', '.well-known/', '.DS_Store'];
const LAST = ['index.html', 'sw.js', 'manifest.webmanifest'];

const cfgPath = path.join(root, argv.find((a) => a.startsWith('--config='))?.slice(9) ?? 'release.json');
if (!existsSync(cfgPath)) fail(`no ${path.relative(root, cfgPath)} in this folder.`);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
for (const k of ['host', 'project', 'parts']) if (!cfg[k] || (Array.isArray(cfg[k]) && !cfg[k].length)) fail(`release.json needs "${k}".`);
if (!/^[a-z0-9_-]+$/i.test(cfg.project)) fail('"project" may hold letters, digits, - and _ only.');
const isLocal = cfg.host === 'local';
const protect = [...PROTECT, ...(cfg.protect ?? [])];
const snapRoot = `backups/${cfg.project}/releases`;
// The host has no UTF-8 locale; forwarding the Mac's makes every remote command print perl warnings.
const sshEnv = { ...process.env, LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'C' };

function fail(message) {
  console.error(`\nRelease stopped: ${message}`);
  process.exit(1);
}
const step = (m) => console.log(`\n> ${m}`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', env: opts.env ?? process.env, input: opts.input, shell: opts.shell ?? false });
  if (r.status !== 0 && !opts.allowFail) fail(`${cmd} ${args.join(' ')} failed (exit ${r.status}).\n${(r.stderr ?? '').trim()}`);
  return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** A bash script on the host, sent on stdin so the login shell expands nothing. Paths are relative to $HOME. */
function remote(script, opts = {}) {
  const body = `set -euo pipefail\ncd "$HOME"\n${script}\n`;
  const r = isLocal ? run('bash', ['-s'], { input: body, allowFail: true }) : run('ssh', ['-o', 'BatchMode=yes', cfg.host, 'bash', '-s'], { input: body, env: sshEnv, allowFail: true });
  const err = r.err.split('\n').filter((l) => l.trim() && !/^perl: warning|^\s+(LANGUAGE|LC_|LANG|are supported)/.test(l)).join('\n');
  if (r.status !== 0 && !opts.allowFail) fail(`remote step failed (exit ${r.status}).\n${err}`);
  return { ...r, err };
}

const dest = (to) => (isLocal ? `${process.env.HOME}/${to}/` : `${cfg.host}:${to}/`);
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// A part may "allow" a protected name it builds itself (e.g. an app folder's own .htaccess); never the web root's.
const excludes = (part) => [...protect.filter((p) => !(part.allow ?? []).includes(p)), ...(part.exclude ?? [])].flatMap((p) => ['--exclude', p]);

function rsync(args) {
  return run('rsync', args, { env: sshEnv, allowFail: true });
}

/** Lists what an upload of `part` would change: [{ file, isNew }]. */
function plan(part) {
  const src = path.join(root, part.from);
  const r = rsync(['-rlt', '--checksum', '--dry-run', '--out-format=%i %n', ...excludes(part), `${src}/`, dest(part.to)]);
  if (r.status !== 0) fail(`dry run for ${part.from} failed.\n${r.err}`);
  return r.out
    .split('\n')
    // '.f' lines are attribute-only (same content), so they are not changes.
    .filter((l) => /^[<>ch]f/.test(l))
    .map((l) => ({ file: l.slice(l.indexOf(' ') + 1), isNew: l.includes('+++++++') }));
}

function snapshots() {
  return remote(`mkdir -p ${snapRoot} && ls -1 ${snapRoot}`).out.split('\n').filter((n) => /^\d{8}T\d{6}Z$/.test(n)).sort();
}

function restore(name) {
  const meta = JSON.parse(remote(`cat ${snapRoot}/${name}/RELEASE.json`).out);
  meta.parts.forEach((p, i) => {
    if (!p.changed.length) return;
    remote(`if [ -d ${snapRoot}/${name}/files/${i} ]; then rsync -rlt ${snapRoot}/${name}/files/${i}/ ${q(p.to)}/; fi`);
    console.log(`  restored ${p.changed.length} file(s) in ${p.to}`);
  });
  if (meta.parts.some((p) => p.added.length)) console.log('  files the release added were left in place (nothing is ever deleted).');
  // The snapshot is used up: the next --rollback goes one release further back.
  remote(`rm -rf -- ${snapRoot}/${name}`, { allowFail: true });
}

async function smoke() {
  const problems = [];
  for (const s of cfg.smoke ?? []) {
    const url = `${cfg.url}${s.path}${s.path.includes('?') ? '&' : '?'}release=${Date.now()}`;
    let status = 0;
    let body = '';
    for (let i = 0; i < 3; i += 1) {
      try {
        const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
        status = res.status;
        body = await res.text();
      } catch (e) {
        body = String(e);
      }
      if (status === (s.status ?? 200)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (status !== (s.status ?? 200)) problems.push(`${s.path} answered ${status}, expected ${s.status ?? 200}`);
    else if (s.contains && !body.includes(s.contains)) problems.push(`${s.path} does not contain ${JSON.stringify(s.contains)}`);
  }
  return problems;
}

// ---- --list / --rollback ----
if (argv.includes('--list')) {
  for (const n of snapshots()) console.log(n);
  process.exit(0);
}
if (argv.includes('--rollback')) {
  const all = snapshots();
  if (!all.length) fail('no snapshot to roll back to.');
  const last = all.at(-1);
  step(`Restoring the files changed by release ${last}`);
  if (!go) {
    console.log('  dry run: add --go to restore.');
    process.exit(0);
  }
  restore(last);
  const problems = await smoke();
  if (problems.length) fail(`smoke checks after rollback:\n  ${problems.join('\n  ')}`);
  console.log('\nRolled back.');
  process.exit(0);
}

// ---- 1. Preflight ----
let short = 'working tree';
let head = '';
let before = '';
if (verify) {
  step('Verify (local only: checks, build and the upload guard; nothing is sent)');
  before = run('git', ['status', '--porcelain']).out;
  console.log(`  ${run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out}${before ? ', with uncommitted changes' : ', clean'}`);
} else {
step('Preflight');
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out;
if (branch !== (cfg.branch ?? 'main')) fail(`on branch ${branch}; release from ${cfg.branch ?? 'main'}.`);
if (run('git', ['status', '--porcelain']).out) fail('the working tree has uncommitted changes.');
run('git', ['fetch', '-q', 'origin', branch]);
head = run('git', ['rev-parse', 'HEAD']).out;
if (head !== run('git', ['rev-parse', `origin/${branch}`]).out) fail(`${branch} is not equal to origin/${branch} (pull or push first).`);
short = head.slice(0, 7);
console.log(`  ${branch} at ${short}, clean, pushed`);
}

// ---- 2. Checks and build ----
if (argv.includes('--skip-checks')) console.log('\n  WARNING: checks skipped (--skip-checks).');
else
  for (const c of cfg.checks ?? []) {
    step(c);
    run(c, [], { inherit: true, shell: true });
  }
if (cfg.build) {
  step(cfg.build);
  run(cfg.build, [], { inherit: true, shell: true });
}
if (run('git', ['status', '--porcelain']).out !== before) fail('checks or build changed tracked files; commit or discard them first.');

for (const part of cfg.parts) {
  const src = path.join(root, part.from);
  if (!existsSync(src) || !statSync(src).isDirectory()) fail(`${part.from} does not exist (did the build run?).`);
  const bad = [];
  // Secrets and dumps stop the release outright. Plain .sql files are simply not sent (protected) unless a part
  // allows "*.sql" for its migrations.
  const banned = /^\.env|\.(sql\.gz|pem|key)$/;
  const skipped = new Set((part.exclude ?? []).filter((e) => /^\/[^*]+\/$/.test(e)).map((e) => path.join(src, e.slice(1, -1))));
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (skipped.has(f)) continue;
      if (statSync(f).isDirectory()) walk(f);
      else if (banned.test(n)) bad.push(path.relative(root, f));
      else if (n === 'config.php' && d !== src && !(part.allow ?? []).includes('config.php')) skippedCode.push(path.relative(root, f));
    }
  };
  const skippedCode = [];
  walk(src);
  if (bad.length) fail(`${part.from} holds files that must never be uploaded: ${bad.join(', ')}`);
  // A file named config.php is never sent (it protects the server's settings). At a part's top level that is the
  // settings slot; deeper down it is code that would silently go missing, so the release stops.
  if (skippedCode.length) fail(`${part.from} holds a file named config.php, which a release never uploads: ${skippedCode.join(', ')}. Rename it (e.g. settings.php), or exclude it if it is a local-only file.`);
}
if (verify) {
  console.log('\nVerified: the checks and build pass and every file can be uploaded. Nothing was sent. Commit and push to deploy.');
  process.exit(0);
}

// ---- 3. Plan ----
step(`Plan (checksum dry run, ${isLocal ? 'local' : cfg.host})`);
const plans = cfg.parts.map((part) => ({ part, items: plan(part) }));
let total = 0;
for (const { part, items } of plans) {
  total += items.length;
  console.log(`  ${part.from} -> ~/${part.to}: ${items.filter((i) => !i.isNew).length} changed, ${items.filter((i) => i.isNew).length} new`);
  for (const i of items.slice(0, 40)) console.log(`    ${i.isNew ? '+' : '~'} ${i.file}`);
  if (items.length > 40) console.log(`    ... and ${items.length - 40} more`);
}
if (!total) {
  console.log('\nNothing to upload: the server already matches.');
  process.exit(0);
}
if (!go) {
  console.log('\nDry run only. Nothing changed. Re-run with --go to release.');
  process.exit(0);
}

// ---- 4. Snapshot ----
const utc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const snap = `${snapRoot}/${utc}`;
step(`Snapshot of the files about to change: ~/${snap}`);
const meta = { commit: head, utc, project: cfg.project, parts: plans.map(({ part, items }) => ({ from: part.from, to: part.to, changed: items.filter((i) => !i.isNew).map((i) => i.file), added: items.filter((i) => i.isNew).map((i) => i.file) })) };
remote(`umask 077; mkdir -p ${snap}/files && cat > ${snap}/RELEASE.json <<'JSON'\n${JSON.stringify(meta, null, 2)}\nJSON`);
meta.parts.forEach((p, i) => {
  if (!p.changed.length) return;
  // Only files that exist on the server are copied (a folder the release creates has nothing to save).
  remote(
    `umask 077; mkdir -p ${snap}/files/${i}\ncat > ${snap}/files/${i}.all <<'LIST'\n${p.changed.join('\n')}\nLIST\n` +
      `while IFS= read -r f; do if [ -f ${q(p.to)}/"$f" ]; then printf '%s\\n' "$f"; fi; done < ${snap}/files/${i}.all > ${snap}/files/${i}.list\n` +
      `if [ -s ${snap}/files/${i}.list ]; then rsync -rlt --files-from=${snap}/files/${i}.list ${q(p.to)}/ ${snap}/files/${i}/; fi`,
  );
});
console.log(`  saved ${meta.parts.reduce((n, p) => n + p.changed.length, 0)} file(s)`);

// ---- 5. Upload ----
for (const { part } of plans) {
  const src = path.join(root, part.from);
  const last = part.last ?? LAST;
  step(`Uploading ${part.from} -> ~/${part.to}`);
  let r = rsync(['-rlt', '--checksum', ...excludes(part), ...last.flatMap((f) => ['--exclude', `/${f}`]), `${src}/`, dest(part.to)]);
  if (r.status === 0) {
    const entry = last.filter((f) => existsSync(path.join(src, f))).map((f) => path.join(src, f));
    if (entry.length) r = rsync(['-lt', '--checksum', ...entry, dest(part.to)]);
  }
  if (r.status !== 0) {
    console.error(`  upload failed: ${r.err}\n  restoring the snapshot`);
    restore(utc);
    fail('upload failed; the changed files were restored.');
  }
}

// ---- 6. Smoke ----
step('Smoke checks');
const problems = await smoke();
if (problems.length) {
  console.error(`  ${problems.join('\n  ')}\n  restoring the snapshot`);
  restore(utc);
  fail('smoke checks failed; the changed files were restored.');
}
console.log(`  ${(cfg.smoke ?? []).length} passed`);

// ---- Keep the newest snapshots ----
const old = snapshots().slice(0, -KEEP);
for (const n of old) remote(`rm -rf -- ${snapRoot}/${n}`, { allowFail: true });
console.log(`\nReleased ${short} (${utc}). Undo with: pnpm release --rollback --go`);
