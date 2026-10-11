import { describe, expect, it } from 'vitest';
import { decideStop } from './docs-sync.mjs';

const input = { hook_event_name: 'Stop', stop_hook_active: false };

describe('decideStop', () => {
  it('never blocks when a Stop hook is already active (no loop)', () => {
    expect(
      decideStop({
        input: { ...input, stop_hook_active: true },
        files: ['src/pages/Rota.tsx'],
        taskContract: '',
      }).block,
    ).toBe(false);
  });

  it('blocks once when code changed and no docs did, naming owners', () => {
    const d = decideStop({
      input,
      files: ['supabase/migrations/0100_x.sql'],
      taskContract: '',
    });
    expect(d.block).toBe(true);
    expect(d.reason).toContain('docs/DATA-MODEL.md');
    expect(d.reason).toContain('Docs: no impact (reason)');
  });

  it('allows when a doc changed too', () => {
    expect(
      decideStop({
        input,
        files: ['src/lib/hours.ts', 'docs/ARCHITECTURE.md'],
        taskContract: '',
      }).block,
    ).toBe(false);
  });

  it('allows when the task contract records a reasoned no-impact', () => {
    expect(
      decideStop({
        input,
        files: ['src/lib/hours.ts'],
        taskContract: '# Task\nDocs: no impact (test-only refactor)\n',
      }).block,
    ).toBe(false);
  });

  it('does not accept the placeholder reason', () => {
    expect(
      decideStop({
        input,
        files: ['src/lib/hours.ts'],
        taskContract: 'Docs: no impact (reason)',
      }).block,
    ).toBe(true);
  });

  it('allows when nothing behaviour-bearing changed, and ignores nested worktrees', () => {
    expect(decideStop({ input, files: ['scripts/x.mjs'], taskContract: '' }).block).toBe(
      false,
    );
    expect(
      decideStop({ input, files: ['.claude/worktrees/a/src/x.ts'], taskContract: '' })
        .block,
    ).toBe(false);
  });
});
