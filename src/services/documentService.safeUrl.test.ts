/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: {}, orgPath: () => '', seg: (s: string) => s }));

import { safeDocumentUrl } from '@/services/documentService';

describe('safeDocumentUrl (security audit, 1 Nov 2026)', () => {
  it('opens https links and paths on this site', () => {
    expect(safeDocumentUrl('https://files.example.org/dbs.pdf')).toBe(
      'https://files.example.org/dbs.pdf',
    );
    expect(safeDocumentUrl('/api/document-files?p=a&e=1&s=x')).toBe(
      `${window.location.origin}/api/document-files?p=a&e=1&s=x`,
    );
  });

  it('refuses script, data and plain-http links', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>1</script>',
      'http://evil.example/x',
      'vbscript:x',
    ]) {
      expect(() => safeDocumentUrl(bad)).toThrow('cannot be opened');
    }
  });
});
