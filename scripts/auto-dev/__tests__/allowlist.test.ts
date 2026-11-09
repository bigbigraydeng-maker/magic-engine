import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_KEYWORDS,
  TRUSTED_AUTHORS,
  isAllowedReferrer,
  isInAllowlist,
  validateVerifyCommand,
} from '../allowlist.mjs';

describe('isInAllowlist', () => {
  it('allows pm-todo source files', () => {
    expect(isInAllowlist('src/lib/pm-todo/foo.ts', 'modified')).toBe(true);
    expect(isInAllowlist('src/lib/pm-todo/bar.tsx', 'modified')).toBe(true);
    expect(isInAllowlist('src/lib/pm-todo/baz.mjs', 'modified')).toBe(true);
  });

  it('rejects ledger-items.ts', () => {
    expect(isInAllowlist('src/lib/pm-todo/ledger-items.ts', 'modified')).toBe(false);
    expect(isInAllowlist('src/lib/pm-todo/ledger-items.ts', 'added')).toBe(false);
  });

  it('allows new test files (status added)', () => {
    expect(isInAllowlist('src/lib/pm-todo/__tests__/foo.test.ts', 'added')).toBe(true);
  });

  it('rejects modified test files', () => {
    expect(isInAllowlist('src/lib/pm-todo/__tests__/foo.test.ts', 'modified')).toBe(false);
    expect(isInAllowlist('src/lib/pm-todo/__tests__/foo.test.ts', 'removed')).toBe(false);
    expect(isInAllowlist('src/lib/pm-todo/__tests__/foo.test.ts', 'renamed')).toBe(false);
    expect(isInAllowlist('src/lib/pm-todo/__tests__/foo.test.ts', 'copied')).toBe(false);
  });

  it('rejects files outside pm-todo', () => {
    expect(isInAllowlist('src/app/page.tsx', 'modified')).toBe(false);
    expect(isInAllowlist('src/lib/other/foo.ts', 'modified')).toBe(false);
  });

  it('allows auto-dev ledger cards regardless of status', () => {
    expect(isInAllowlist('docs/ledger/2026-01-auto-dev-foo.md', 'modified')).toBe(true);
    expect(isInAllowlist('docs/ledger/2026-01-auto-dev-foo.md', 'added')).toBe(true);
  });
});

describe('isAllowedReferrer', () => {
  it('allows pm-todo internals', () => {
    expect(isAllowedReferrer('src/lib/pm-todo/foo.ts')).toBe(true);
    expect(isAllowedReferrer('src/lib/pm-todo/__tests__/foo.test.ts')).toBe(true);
  });

  it('allows cron pm- routes', () => {
    expect(isAllowedReferrer('src/app/api/cron/pm-daily-todo/route.ts')).toBe(true);
  });

  it('rejects other routes', () => {
    expect(isAllowedReferrer('src/app/api/workbench/today/route.ts')).toBe(false);
  });
});

describe('validateVerifyCommand', () => {
  const allowed = ['src/lib/pm-todo/foo.ts'];

  it('accepts a valid trunk test path', () => {
    expect(validateVerifyCommand('npm test -- src/lib/pm-todo/__tests__/foo.test.ts', allowed)).toEqual({
      valid: true,
    });
  });

  it('accepts a path listed in allowedFiles', () => {
    expect(validateVerifyCommand('npm test -- src/lib/pm-todo/foo.ts', allowed)).toEqual({ valid: true });
  });

  it('rejects commands with -u', () => {
    const result = validateVerifyCommand('npm test -- -u', allowed);
    expect(result.valid).toBe(false);
  });

  it('rejects commands with ..', () => {
    const result = validateVerifyCommand('npm test -- ../foo.ts', allowed);
    expect(result.valid).toBe(false);
  });

  it('rejects non-npm-test commands', () => {
    expect(validateVerifyCommand('npm run build', allowed).valid).toBe(false);
    expect(validateVerifyCommand('echo hi', allowed).valid).toBe(false);
  });

  it('rejects paths with special chars', () => {
    expect(validateVerifyCommand('npm test -- src/lib/pm-todo/foo bar.ts', allowed).valid).toBe(false);
    expect(validateVerifyCommand('npm test -- src/lib/pm-todo/foo;rm.ts', allowed).valid).toBe(false);
  });
});

describe('constants', () => {
  it('exposes trusted authors', () => {
    expect(TRUSTED_AUTHORS).toContain('bigbigraydeng-maker');
  });

  it('exposes production keywords', () => {
    expect(PRODUCTION_KEYWORDS).toContain('生产');
    expect(PRODUCTION_KEYWORDS).toContain('production');
  });
});
