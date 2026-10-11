import { describe, expect, it } from 'vitest';
import {
  decideDocsImpact,
  isCodePath,
  isDocPath,
  noImpactReason,
  owningDocs,
} from './check-docs-impact.mjs';

describe('isCodePath / isDocPath', () => {
  it('classifies behaviour-bearing paths', () => {
    for (const p of [
      'src/pages/Rota.tsx',
      'supabase/migrations/0100_x.sql',
      'supabase/functions/stripe-webhook/index.ts',
      'e2e/marketing.spec.ts',
      '.github/workflows/ci.yml',
      'package.json',
      'index.html',
      'public/manifest.webmanifest',
    ]) {
      expect(isCodePath(p), p).toBe(true);
    }
    for (const p of [
      'package-lock.json',
      'scripts/x.mjs',
      'README.md',
      '.github/dependabot.yml',
    ]) {
      expect(isCodePath(p), p).toBe(false);
    }
  });

  it('counts root markdown, docs/ and qa/ as documentation, nothing nested elsewhere', () => {
    expect(isDocPath('README.md')).toBe(true);
    expect(isDocPath('CHANGELOG.md')).toBe(true);
    expect(isDocPath('docs/SAAS.md')).toBe(true);
    expect(isDocPath('docs/design/x.png')).toBe(true);
    expect(isDocPath('qa/README.md')).toBe(true);
    expect(isDocPath('.github/pull_request_template.md')).toBe(false);
    expect(isDocPath('src/README.md')).toBe(false);
  });
});

describe('noImpactReason', () => {
  it('accepts a real reason at the start of a line, case-insensitively', () => {
    expect(
      noImpactReason('Summary\n\nDocs: no impact (refactor, no behaviour change)'),
    ).toBe('refactor, no behaviour change');
    expect(noImpactReason('docs: No Impact (test-only)\r\n')).toBe('test-only');
  });

  it('rejects a missing, empty or placeholder reason', () => {
    expect(noImpactReason('')).toBeNull();
    expect(noImpactReason(undefined)).toBeNull();
    expect(noImpactReason('Docs: no impact')).toBeNull();
    expect(noImpactReason('Docs: no impact ()')).toBeNull();
    expect(noImpactReason('Docs: no impact (reason)')).toBeNull();
    expect(noImpactReason('Write `Docs: no impact (x)` if so')).toBeNull();
  });
});

describe('decideDocsImpact', () => {
  it('fails when code changes and no docs change and no rationale is given', () => {
    const r = decideDocsImpact({
      files: ['src/pages/admin/Orgs.tsx'],
      body: 'Fixes a bug',
    });
    expect(r.status).toBe('fail');
    expect(r.owners.get('src/pages/admin')?.docs).toContain('docs/UX-SPEC.md');
  });

  it('passes when a doc changed alongside the code', () => {
    const r = decideDocsImpact({
      files: ['supabase/migrations/0100_x.sql', 'docs/DATA-MODEL.md'],
    });
    expect(r.status).toBe('pass');
  });

  it('passes on an explicit, reasoned no-impact declaration', () => {
    const r = decideDocsImpact({
      files: ['src/lib/hours.ts'],
      body: '## Docs\nDocs: no impact (internal rename only)',
    });
    expect(r.status).toBe('pass');
    expect(r.reason).toContain('internal rename only');
  });

  it('passes when nothing behaviour-bearing changed', () => {
    expect(decideDocsImpact({ files: ['scripts/x.mjs'] }).status).toBe('pass');
    expect(decideDocsImpact({ files: [] }).status).toBe('pass');
  });

  it('exempts dependabot by actor or head ref, and lockfile-only changes', () => {
    expect(
      decideDocsImpact({ files: ['package.json'], actor: 'dependabot[bot]' }).status,
    ).toBe('exempt');
    expect(
      decideDocsImpact({ files: ['package.json'], headRef: 'dependabot/npm_and_yarn/x' })
        .status,
    ).toBe('exempt');
    expect(decideDocsImpact({ files: ['package-lock.json'] }).status).toBe('exempt');
  });

  it('does not count the PR template as documentation', () => {
    const r = decideDocsImpact({
      files: ['.github/workflows/ci.yml', '.github/pull_request_template.md'],
    });
    expect(r.status).toBe('fail');
  });
});

describe('owningDocs', () => {
  it('maps migrations to the data model and the register, functions to the API spec', () => {
    const owners = owningDocs([
      'supabase/migrations/0100_x.sql',
      'supabase/functions/invite/index.ts',
      'src/pages/Rota.tsx',
    ]);
    expect(owners.get('supabase/migrations')?.docs).toEqual([
      'docs/DATA-MODEL.md',
      'docs/SAAS.md',
    ]);
    expect(owners.get('supabase/functions')?.docs).toContain('docs/API-SPEC.md');
    expect(owners.get('src/pages')?.docs).toEqual(['docs/UX-SPEC.md']);
  });
});
