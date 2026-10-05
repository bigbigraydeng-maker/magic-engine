import { readdirSync, readFileSync, statSync } from 'node:fs';
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

const ALLOWED_DEFINERS = new Set(['lib/meta/boost.ts', 'lib/meta/client.ts']);

describe('boostPagePost architecture guard', () => {
  it('no production file other than the definer and the re-export mentions boostPagePost', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const rel = toRel(file);
      if (ALLOWED_DEFINERS.has(rel)) {
        continue;
      }
      const text = readFileSync(file, 'utf8');
      if (/\bboostPagePost\b/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nothing imports the boost module directly', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const rel = toRel(file);
      if (rel === 'lib/meta/client.ts') {
        continue;
      }
      if (rel === 'lib/meta/boost.ts') {
        continue;
      }
      const text = readFileSync(file, 'utf8');
      const staticImport = /from\s+['"][^'"]*\/boost['"]/.test(text);
      const dynamicImport = /import\(\s*['"][^'"]*\/boost['"]\s*\)/.test(text);
      const requireCall = /require\(\s*['"][^'"]*\/boost['"]\s*\)/.test(text);
      if (staticImport || dynamicImport || requireCall) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the route files under src/app/api never reference the boost module or the re-export', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const rel = toRel(file);
      if (!rel.startsWith('app/api/')) {
        continue;
      }
      const text = readFileSync(file, 'utf8');
      if (/\bboostPagePost\b|lib\/meta\/boost/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scan actually sees the definer and the re-export', () => {
    const files = listSourceFiles(SRC_ROOT).map(toRel);
    expect(files).toContain('lib/meta/boost.ts');
    expect(files).toContain('lib/meta/client.ts');
    expect(files.length).toBeGreaterThan(200);

    const clientText = readFileSync(join(SRC_ROOT, 'lib', 'meta', 'client.ts'), 'utf8');
    expect(clientText).toContain('boostPagePost');
  });
});
