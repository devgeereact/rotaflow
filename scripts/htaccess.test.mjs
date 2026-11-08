import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  composeHtaccess,
  driftLines,
  makeSmoke,
  parseArgs,
  pushHtaccess,
  sshRunner,
  whitespaceOnly,
} from './htaccess.mjs';

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
    const r = await pushHtaccess({
      composed,
      run: s.run,
      smoke: s.smoke,
      acceptExtra: true,
    });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(s.calls).toEqual(['read', 'backup', 'write', 'move', 'smoke']);
    expect(s.files['~/rotaflow.space/.htaccess']).toBe(composed);
    expect(s.files.backup).toBe('OLD\n');
  });

  it('does nothing when live already matches', async () => {
    const s = fakeServer({ live: composed });
    const r = await pushHtaccess({
      composed,
      run: s.run,
      smoke: s.smoke,
      acceptExtra: true,
    });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(s.calls).toEqual(['read']);
  });

  it('never writes if the backup fails', async () => {
    const s = fakeServer({ live: 'OLD\n', failOn: ['backup'] });
    await expect(
      pushHtaccess({ composed, run: s.run, smoke: s.smoke, acceptExtra: true }),
    ).rejects.toThrow(/backup/);
    expect(s.calls).toEqual(['read', 'backup']);
    expect(s.files['~/rotaflow.space/.htaccess']).toBe('OLD\n');
  });

  it('puts the old file back if the site fails its smoke check', async () => {
    const s = fakeServer({ live: 'OLD\n', smokeOk: false });
    const r = await pushHtaccess({
      composed,
      run: s.run,
      smoke: s.smoke,
      acceptExtra: true,
    });
    expect(r).toMatchObject({ ok: false, changed: false, rolledBack: true });
    expect(s.calls).toEqual([
      'read',
      'backup',
      'write',
      'move',
      'smoke',
      'restore',
      'smoke',
    ]);
    expect(s.files['~/rotaflow.space/.htaccess']).toBe('OLD\n');
  });

  it('restores if the move itself fails after the write', async () => {
    const s = fakeServer({ live: 'OLD\n', failOn: ['move'] });
    await expect(
      pushHtaccess({ composed, run: s.run, smoke: s.smoke, acceptExtra: true }),
    ).rejects.toThrow(/move/);
    expect(s.calls).toContain('restore');
    expect(s.files['~/rotaflow.space/.htaccess']).toBe('OLD\n');
  });
});

describe('pushHtaccess when things go wrong', () => {
  const composed = 'NEW\n';

  it('puts the old file back if the smoke check itself throws', async () => {
    const s = fakeServer({ live: 'OLD\n', smokeThrows: true });
    const r = await pushHtaccess({
      composed,
      run: s.run,
      smoke: s.smoke,
      acceptExtra: true,
    });
    expect(r).toMatchObject({ ok: false, rolledBack: true });
    expect(s.calls).toContain('restore');
    expect(s.files['~/rotaflow.space/.htaccess']).toBe('OLD\n');
  });

  it('cleans up the half-written file when the write fails, and leaves the live file alone', async () => {
    const s = fakeServer({ live: 'OLD\n', failOn: ['write'] });
    await expect(
      pushHtaccess({ composed, run: s.run, smoke: s.smoke, acceptExtra: true }),
    ).rejects.toThrow(/write/);
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

/** An ssh stand-in: records the remote command of each call and answers like a server (sha256sum of what was piped in). */
function fakeSsh({ corruptUpload = false } = {}) {
  const commands = [];
  const exec = (_file, args, opts = {}) => {
    const cmd = args.at(-1);
    commands.push({ cmd, input: opts.input, opts });
    if (cmd.includes('sha256sum')) {
      const real = createHash('sha256')
        .update(opts.input ?? '')
        .digest('hex');
      return `${corruptUpload ? 'f'.repeat(64) : real}  /home/x/rotaflow.space/.htaccess.new\n`;
    }
    return '';
  };
  return { exec, commands };
}

describe('sshRunner: the real command strings', () => {
  it('never writes --option=~/path, because a shell does not expand a tilde there', () => {
    const f = fakeSsh();
    const r = sshRunner('cpanel', 'rotaflow.space', f.exec);
    for (const step of ['read', 'backup', 'move', 'restore', 'cleanup']) r.run(step);
    r.run('write', 'NEW\n');
    expect(f.commands.length).toBeGreaterThan(5);
    for (const c of f.commands) expect(c.cmd, c.cmd).not.toMatch(/=~/);
  });

  it('copies the live file mode with --reference as a separate word', () => {
    const f = fakeSsh();
    sshRunner('cpanel', 'rotaflow.space', f.exec).run('write', 'NEW\n');
    expect(f.commands[0].cmd).toContain(
      'chmod --reference ~/rotaflow.space/.htaccess ~/rotaflow.space/.htaccess.new',
    );
    expect(f.commands[0].input).toBe('NEW\n');
  });

  it('restores through a file beside the live one and a move, never by copying over it', () => {
    const f = fakeSsh();
    sshRunner('cpanel', 'rotaflow.space', f.exec).run('restore');
    const cmd = f.commands[0].cmd;
    expect(cmd).toMatch(/cp -p \S+ ~\/rotaflow\.space\/\.htaccess\.restore/);
    expect(cmd).toContain(
      'mv ~/rotaflow.space/.htaccess.restore ~/rotaflow.space/.htaccess',
    );
    expect(cmd).not.toMatch(/cp -p \S+ ~\/rotaflow\.space\/\.htaccess(\s|$)/);
  });

  it('cleans up both the new file and a half-made restore file', () => {
    const f = fakeSsh();
    sshRunner('cpanel', 'rotaflow.space', f.exec).run('cleanup');
    expect(f.commands[0].cmd).toContain('.htaccess.new');
    expect(f.commands[0].cmd).toContain('.htaccess.restore');
  });

  it('refuses an upload whose checksum on the server differs from what was sent', () => {
    const f = fakeSsh({ corruptUpload: true });
    expect(() =>
      sshRunner('cpanel', 'rotaflow.space', f.exec).run('write', 'NEW\n'),
    ).toThrow(/does not match/);
  });

  it('accepts an upload whose checksum matches', () => {
    const f = fakeSsh();
    expect(() =>
      sshRunner('cpanel', 'rotaflow.space', f.exec).run('write', 'NEW\n'),
    ).not.toThrow();
  });

  it('refuses to build commands without a document root', () => {
    expect(() => sshRunner('cpanel', undefined, fakeSsh().exec)).toThrow(
      /document root/i,
    );
  });
});

describe('whitespaceOnly', () => {
  it('is true when only whitespace or line endings differ', () => {
    expect(whitespaceOnly('a\nb\n', 'a\r\nb\r\n')).toBe(true);
    expect(whitespaceOnly('a\n', 'a')).toBe(true);
  });
  it('is false for identical files and for real differences', () => {
    expect(whitespaceOnly('a\n', 'a\n')).toBe(false);
    expect(whitespaceOnly('a\n', 'b\n')).toBe(false);
  });
});

describe('parseArgs', () => {
  it('accepts the options each command has', () => {
    expect(parseArgs('compose', ['--out=x.txt'])).toEqual({
      out: 'x.txt',
      go: false,
      acceptExtra: false,
    });
    expect(parseArgs('push', ['--go'])).toEqual({
      out: undefined,
      go: true,
      acceptExtra: false,
    });
    expect(parseArgs('diff', [])).toEqual({
      out: undefined,
      go: false,
      acceptExtra: false,
    });
  });
  it('rejects an option on a command that does not take it', () => {
    expect(() => parseArgs('compose', ['--go'])).toThrow(/unknown option --go/);
    expect(() => parseArgs('diff', ['--out=x'])).toThrow(/unknown option/);
    expect(() => parseArgs('push', ['--bad'])).toThrow(/unknown option --bad/);
  });
});

describe('what a rollback must preserve and report', () => {
  const composed = 'NEW\n';

  it('backs the live file up without changing its mode, so a restore keeps it readable by the web server', () => {
    const f = fakeSsh();
    sshRunner('cpanel', 'rotaflow.space', f.exec).run('backup');
    expect(f.commands[0].cmd).toContain('cp -p');
    expect(f.commands[0].cmd).not.toMatch(/chmod/);
  });

  it('checks the site again after rolling back, and says whether it answers', async () => {
    const s = fakeServer({ live: 'OLD\n', smokeOk: false });
    const r = await pushHtaccess({
      composed,
      run: s.run,
      smoke: s.smoke,
      acceptExtra: true,
    });
    expect(r).toMatchObject({ ok: false, rolledBack: true, siteAfterRollback: false });
    const good = fakeServer({ live: 'OLD\n' });
    let n = 0;
    const r2 = await pushHtaccess({
      composed,
      run: good.run,
      smoke: () => (n += 1) > 1,
      acceptExtra: true,
    });
    expect(r2).toMatchObject({ rolledBack: true, siteAfterRollback: true });
  });

  it('reports both problems when the rollback itself fails', async () => {
    const s = fakeServer({ live: 'OLD\n', smokeOk: false, failOn: ['restore'] });
    await expect(
      pushHtaccess({ composed, run: s.run, smoke: s.smoke, acceptExtra: true }),
    ).rejects.toThrow(/smoke check failed.*rollback also failed/is);
  });

  it('refuses to overwrite live lines it cannot explain, unless told to', async () => {
    const s = fakeServer({ live: 'SAME\nSOMEONE EDITED THIS BY HAND\n' });
    await expect(
      pushHtaccess({ composed: 'SAME\n', run: s.run, smoke: s.smoke }),
    ).rejects.toThrow(/SOMEONE EDITED THIS BY HAND/);
    expect(s.calls).toEqual(['read']);
    const s2 = fakeServer({ live: 'SAME\nSOMEONE EDITED THIS BY HAND\n' });
    const r = await pushHtaccess({
      composed: 'SAME\n',
      run: s2.run,
      smoke: s2.smoke,
      acceptExtra: true,
    });
    expect(r.ok).toBe(true);
  });

  it('does not treat a missing hardening line as unexplained: only extra live lines block', async () => {
    const s = fakeServer({ live: 'SAME\n' });
    const r = await pushHtaccess({
      composed: 'SAME\nNEW LINE\n',
      run: s.run,
      smoke: s.smoke,
    });
    expect(r.ok).toBe(true);
  });

  it('gives every ssh call a time limit, so a stalled connection cannot hang the push', () => {
    const f = fakeSsh();
    sshRunner('cpanel', 'rotaflow.space', f.exec).run('read');
    expect(f.commands[0].opts.timeout).toBeGreaterThan(0);
  });

  it('accepts --accept-extra only on push', () => {
    expect(parseArgs('push', ['--go', '--accept-extra'])).toMatchObject({
      go: true,
      acceptExtra: true,
    });
    expect(() => parseArgs('diff', ['--accept-extra'])).toThrow(/unknown option/);
    expect(parseArgs('push', [])).toMatchObject({ acceptExtra: false });
  });
});
