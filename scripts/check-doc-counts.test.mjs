import { describe, expect, it } from 'vitest';
import {
  ciJobClaims,
  countWorkflowJobs,
  edgeFunctionClaims,
  engineNodeMajor,
  extractLinkTargets,
  nodeClaims,
  parseCount,
} from './check-doc-counts.mjs';

describe('parseCount', () => {
  it('reads digits, words and bold words, and refuses anything else', () => {
    expect(parseCount('6')).toBe(6);
    expect(parseCount('six')).toBe(6);
    expect(parseCount('**Six**')).toBe(6);
    expect(parseCount('twenty')).toBe(20);
    expect(parseCount('Supabase')).toBeNull();
    expect(parseCount('constructor')).toBeNull();
    expect(parseCount('')).toBeNull();
  });
});

describe('countWorkflowJobs', () => {
  it('counts only top-level job ids under jobs:', () => {
    const yaml = [
      'name: CI',
      'jobs:',
      '  verify:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo',
      '  e2e:',
      '    env:',
      '      TZ: UTC',
      'other:',
      '  notajob:',
    ].join('\n');
    expect(countWorkflowJobs(yaml)).toBe(2);
    expect(countWorkflowJobs('name: x')).toBe(0);
  });
});

describe('claim finders', () => {
  it('finds CI job counts only next to a mention of CI', () => {
    expect(
      ciJobClaims('`ci.yml` runs these as **six** jobs, not one').map((c) => c.n),
    ).toEqual([6]);
    expect(ciJobClaims('inside Postgres — **four** jobs, verified')).toEqual([]);
    expect(ciJobClaims('The two Supabase jobs need Docker and CI')).toEqual([]);
  });

  it('finds Edge Function totals and skips billing subsets', () => {
    expect(
      edgeFunctionClaims('typecheck of all eight Edge entry points').map((c) => c.n),
    ).toEqual([8]);
    expect(
      edgeFunctionClaims('deploy any of the\n  eight Edge Functions').map((c) => c.n),
    ).toEqual([8]);
    expect(
      edgeFunctionClaims(
        'Stripe (Checkout, Portal and a webhook, all three Edge Functions',
      ),
    ).toEqual([]);
    expect(edgeFunctionClaims('a Supabase Edge Function')).toEqual([]);
  });

  it('finds statements of the current Node requirement, not history', () => {
    expect(nodeClaims('CI runs **Node 22** since').map((c) => c.n)).toEqual([22]);
    expect(nodeClaims('- Node.js **>= 20**').map((c) => c.n)).toEqual([20]);
    expect(nodeClaims('on Node 20 anything constructing a client died')).toEqual([]);
    expect(engineNodeMajor('{"engines":{"node":">=22.0.0"}}')).toBe(22);
    expect(engineNodeMajor('{}')).toBeNull();
  });
});

describe('extractLinkTargets', () => {
  it('extracts relative links and backticked docs/qa paths, skipping the rest', () => {
    const md = [
      'See [rules](RULES.md#top) and [web](https://x.y) and [anchor](#a) and [route](/app/x).',
      'Owner: `docs/SAAS.md`, also `qa/README.md:12` and `docs/*.md` and `src/x.ts`.',
      '```',
      '[inside](fence.md) `docs/FENCED.md`',
      '```',
      'The `docs/audit01.md` file (deleted 2026-08-04).',
      '[spaced](My%20Doc.md)',
    ].join('\n');
    expect(extractLinkTargets(md)).toEqual([
      { target: 'RULES.md', fromRoot: false, line: 1 },
      { target: 'docs/SAAS.md', fromRoot: true, line: 2 },
      { target: 'qa/README.md', fromRoot: true, line: 2 },
      { target: 'My Doc.md', fromRoot: false, line: 7 },
    ]);
  });
});
