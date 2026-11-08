import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composeHtaccess, driftLines, makeSmoke, pushHtaccess } from './htaccess.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoFile = readFileSync(join(root, '.htaccess'), 'utf8');
const lock = readFileSync(join(root, 'scripts/htaccess/origin-lock.conf'), 'utf8');

describe('composeHtaccess', () => {
  it('puts the origin lock first and the repository file after it, unchanged', () => {
    const out = composeHtaccess(repoFile, lock);
    expect(out.startsWith(lock)).toBe(true);
    expect(out.endsWith(repoFile)).toBe(true);
    expect(out.length).toBe(lock.length + repoFile.length);
  });

  it('is idempotent: composing its own output changes nothing', () => {
    const once = composeHtaccess(repoFile, lock);
    expect(composeHtaccess(once, lock)).toBe(once);
  });

  it('carries the server-banner hardening from the repository file', () => {
    const out = composeHtaccess(repoFile, lock);
    expect(out).toContain('ServerSignature Off');
    expect(out).toMatch(/Header (always )?unset X-Turbo-Charged-By/);
    expect(out).toMatch(/Header (always )?unset X-Powered-By/);
  });

  it('keeps the lock shaped as the live one: CF-RAY required, ACME path exempt', () => {
    expect(lock).toContain('# === BEGIN Cloudflare-origin-lock');
    expect(lock).toContain('# === END Cloudflare-origin-lock ===');
    expect(lock).toContain('RewriteCond %{HTTP:CF-RAY} ^$');
    expect(lock).toContain('!^/\\.well-known/');
  });

  it('refuses a lock block that is not a lock block', () => {
    expect(() => composeHtaccess(repoFile, '# nothing here\n')).toThrow(/origin lock/i);
  });
});

describe('driftLines', () => {
  it('lists the lines a live file lacks and the ones it has extra', () => {
    const d = driftLines('a\nb\nc\n', 'a\nc\nd\n');
    expect(d.missingFromLive).toEqual(['b']);
    expect(d.extraInLive).toEqual(['d']);
  });

  it('is empty when the files match', () => {
    expect(driftLines('a\nb\n', 'a\nb\n')).toEqual({
      missingFromLive: [],
      extraInLive: [],
    });
  });
});

/** A scripted server: records every command, answers from a map, and can be told to fail a step. */
function fakeServer({ live, failOn = [], smokeOk = true, smokeThrows = false } = {}) {
  const calls = [];
  const files = { '~/rotaflow.space/.htaccess': live };
  return {
    calls,
    files,
    run(step, arg) {
      calls.push(step);
      if (failOn.includes(step)) throw new Error(`${step} failed`);
      if (step === 'read') return files['~/rotaflow.space/.htaccess'];
      if (step === 'backup') files.backup = files['~/rotaflow.space/.htaccess'];
      if (step === 'write') files.tmp = arg;
      if (step === 'move') files['~/rotaflow.space/.htaccess'] = files.tmp;
      if (step === 'restore') files['~/rotaflow.space/.htaccess'] = files.backup;
      if (step === 'cleanup') delete files.tmp;
      return '';
    },
    smoke() {
      calls.push('smoke');
      if (smokeThrows) throw new Error('fetch failed');
      return smokeOk;
    },
  };
}

describe('pushHtaccess', () => {
  const composed = 'NEW\n';

  it('backs up, writes beside, moves into place, then smokes, in that order', async () => {
    const s = fakeServer({ live: 'OLD\n' });
    const r = await pushHtaccess({ composed, run: s.run, smoke: s.smoke });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(s.calls).toEqual(['read', 'backup', 'write', 'move', 'smoke']);
    expect(s.files['~/rotaflow.space/.htaccess']).toBe(composed);
    expect(s.files.backup).toBe('OLD\n');
  });

  it('does nothing when live already matches', async () => {
    const s = fakeServer({ live: composed });
    const r = await pushHtaccess({ composed, run: s.run, smoke: s.smoke });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(s.calls).toEqual(['read']);
  });

  it('never writes if the backup fails', async () => {
    const s = fakeServer({ live: 'OLD\n', failOn: ['backup'] });
    await expect(pushHtaccess({ composed, run: s.run, smoke: s.smoke })).rejects.toThrow(
      /backup/,
    );
    expect(s.calls).toEqual(['read', 'backup']);
    expect(s.files['~/rotaflow.space/.htaccess']).toBe('OLD\n');
  });

  it('puts the old file back if the site fails its smoke check', async () => {
    const s = fakeServer({ live: 'OLD\n', smokeOk: false });
    const r = await pushHtaccess({ composed, run: s.run, smoke: s.smoke });
    expect(r).toMatchObject({ ok: false, changed: false, rolledBack: true });
    expect(s.calls).toEqual(['read', 'backup', 'write', 'move', 'smoke', 'restore']);
    expect(s.files['~/rotaflow.space/.htaccess']).toBe('OLD\n');
  });

  it('restores if the move itself fails after the write', async () => {
    const s = fakeServer({ live: 'OLD\n', failOn: ['move'] });
    await expect(pushHtaccess({ composed, run: s.run, smoke: s.smoke })).rejects.toThrow(
      /move/,
    );
    expect(s.calls).toContain('restore');
    expect(s.files['~/rotaflow.space/.htaccess']).toBe('OLD\n');
  });
});

describe('pushHtaccess when things go wrong', () => {
  const composed = 'NEW\n';

  it('puts the old file back if the smoke check itself throws', async () => {
    const s = fakeServer({ live: 'OLD\n', smokeThrows: true });
    const r = await pushHtaccess({ composed, run: s.run, smoke: s.smoke });
    expect(r).toMatchObject({ ok: false, rolledBack: true });
    expect(s.calls.at(-1)).toBe('restore');
    expect(s.files['~/rotaflow.space/.htaccess']).toBe('OLD\n');
  });

  it('cleans up the half-written file when the write fails, and leaves the live file alone', async () => {
    const s = fakeServer({ live: 'OLD\n', failOn: ['write'] });
    await expect(pushHtaccess({ composed, run: s.run, smoke: s.smoke })).rejects.toThrow(
      /write/,
    );
    expect(s.calls).toEqual(['read', 'backup', 'write', 'cleanup']);
    expect(s.files['~/rotaflow.space/.htaccess']).toBe('OLD\n');
  });
});

describe('makeSmoke', () => {
  const checks = [
    { path: '/', status: 200 },
    { path: '/api/health', status: 200, contains: '"ok":true' },
  ];
  const reply = (status, body = '') => ({ status, text: async () => body });

  it('passes when every check answers as expected', async () => {
    const smoke = makeSmoke({
      base: 'https://x.test',
      checks,
      fetchImpl: async (u) =>
        u.endsWith('health') ? reply(200, '{"ok":true}') : reply(200),
    });
    expect(await smoke()).toBe(true);
  });

  it('fails, without throwing, on a wrong status or a missing body marker', async () => {
    expect(
      await makeSmoke({
        base: 'https://x.test',
        checks,
        fetchImpl: async () => reply(403),
      })(),
    ).toBe(false);
    expect(
      await makeSmoke({
        base: 'https://x.test',
        checks,
        fetchImpl: async () => reply(200, 'nope'),
      })(),
    ).toBe(false);
  });

  it('survives one network error by retrying, but not endless ones', async () => {
    let n = 0;
    const flaky = async () => {
      n += 1;
      if (n === 1) throw new Error('reset');
      return reply(200, '{"ok":true}');
    };
    expect(await makeSmoke({ base: 'https://x.test', checks, fetchImpl: flaky })()).toBe(
      true,
    );
    const down = async () => {
      throw new Error('down');
    };
    expect(await makeSmoke({ base: 'https://x.test', checks, fetchImpl: down })()).toBe(
      false,
    );
  });

  it('gives each request a time limit', async () => {
    let signal;
    await makeSmoke({
      base: 'https://x.test',
      checks: [checks[0]],
      fetchImpl: async (_u, o) => ((signal = o.signal), reply(200)),
    })();
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
