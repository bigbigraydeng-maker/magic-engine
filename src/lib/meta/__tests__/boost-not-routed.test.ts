import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC_ROOT = join(__dirname, '..', '..', '..');

const SKIP_DIRS = new Set(['__tests__', 'node_modules']);

function listSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (SKIP_DIRS.has(entry)) {
        continue;
      }
      results.push(...listSourceFiles(full));
      continue;
    }
    if (!stats.isFile()) {
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) {
      continue;
    }
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
      continue;
    }
    results.push(full);
  }
  return results;
}

function toRel(absPath: string): string {
  return relative(SRC_ROOT, absPath).split(sep).join('/');
}

// boostPagePost created Meta campaigns/ad sets/ads directly as ACTIVE with no
// approval, receipt or budget check. It had no callers and was removed on
// 2026-10-06; these guards keep it from coming back under the same name/module.
describe('boostPagePost stays retired', () => {
  it('the boost module no longer exists', () => {
    expect(existsSync(join(SRC_ROOT, 'lib', 'meta', 'boost.ts'))).toBe(false);
  });

  it('no production file mentions boostPagePost', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      if (/\bboostPagePost\b/.test(text)) {
        offenders.push(toRel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nothing imports a meta boost module', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      const staticImport = /from\s+['"][^'"]*meta\/boost['"]|from\s+['"]\.\/boost['"]/.test(text);
      const dynamicImport = /import\(\s*['"][^'"]*\/boost['"]\s*\)/.test(text);
      const requireCall = /require\(\s*['"][^'"]*\/boost['"]\s*\)/.test(text);
      if (staticImport || dynamicImport || requireCall) {
        offenders.push(toRel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scan actually sees the meta client and the wider source tree', () => {
    const files = listSourceFiles(SRC_ROOT).map(toRel);
    expect(files).toContain('lib/meta/client.ts');
    expect(files.length).toBeGreaterThan(200);
  });
});
