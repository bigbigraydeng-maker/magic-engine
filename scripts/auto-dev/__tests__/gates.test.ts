import { describe, expect, it } from 'vitest';

import {
  CONTENT_BANS,
  diffByHash,
  gateAllowedFiles,
  gateContentBans,
  gateCostCap,
  gateLineCount,
  gateRiskLevel,
  gateSecretScan,
  gateVerifyCommands,
  runAllGates,
} from '../gates.mjs';

describe('diffByHash', () => {
  it('returns empty for two empty maps', () => {
    expect(diffByHash(new Map(), new Map())).toEqual([]);
  });

  it('detects added files', () => {
    const after = new Map([['a.ts', 'h1']]);
    expect(diffByHash(new Map(), after)).toEqual([{ filePath: 'a.ts', status: 'added' }]);
  });

  it('detects deleted files', () => {
    const before = new Map([['a.ts', 'h1']]);
    expect(diffByHash(before, new Map())).toEqual([{ filePath: 'a.ts', status: 'deleted' }]);
  });

  it('detects modified files', () => {
    const before = new Map([['a.ts', 'h1']]);
    const after = new Map([['a.ts', 'h2']]);
    expect(diffByHash(before, after)).toEqual([{ filePath: 'a.ts', status: 'modified' }]);
  });

  it('omits unchanged files', () => {
    const before = new Map([['a.ts', 'h1']]);
    const after = new Map([['a.ts', 'h1']]);
    expect(diffByHash(before, after)).toEqual([]);
  });

  it('returns sorted by filePath', () => {
    const after = new Map([['c.ts', 'h1'], ['a.ts', 'h2']]);
    const result = diffByHash(new Map(), after);
    expect(result[0].filePath).toBe('a.ts');
    expect(result[1].filePath).toBe('c.ts');
  });
});

describe('gateAllowedFiles', () => {
  const allowlist = (path: string) => path.startsWith('src/lib/pm-todo/');

  it('passes when all files are in allowlist', () => {
    const changes = [{ filePath: 'src/lib/pm-todo/a.ts', status: 'modified' }];
    const result = gateAllowedFiles(changes, ['src/lib/pm-todo/a.ts'], allowlist);
    expect(result).toEqual({ pass: true });
  });

  it('fails for file outside allowlist', () => {
    const changes = [{ filePath: 'src/app/page.tsx', status: 'modified' }];
    const result = gateAllowedFiles(changes, ['src/app/page.tsx'], () => false);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('src/app/page.tsx');
  });

  it('allows auto-dev ledger cards', () => {
    const changes = [{ filePath: 'docs/ledger/2026-01-auto-dev-foo.md', status: 'modified' }];
    const result = gateAllowedFiles(changes, [], (p: string) => /^docs\/ledger\/.*-auto-dev-.*\.md$/.test(p));
    expect(result).toEqual({ pass: true });
  });

  it('allows added test files', () => {
    const changes = [{ filePath: 'src/lib/pm-todo/__tests__/new.test.ts', status: 'added' }];
    const result = gateAllowedFiles(changes, [], allowlist);
    expect(result).toEqual({ pass: true });
  });
});

describe('gateRiskLevel', () => {
  it('passes for B/C risk', () => {
    const changes = [{ filePath: 'a.ts', status: 'modified' }];
    expect(gateRiskLevel(changes, () => ({ risk: 'B' }))).toEqual({ pass: true });
    expect(gateRiskLevel(changes, () => ({ risk: 'C' }))).toEqual({ pass: true });
  });

  it('fails for A risk', () => {
    const changes = [{ filePath: 'a.ts', status: 'modified' }];
    const result = gateRiskLevel(changes, () => ({ risk: 'A' }));
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('a.ts');
  });
});

describe('gateLineCount', () => {
  it('passes at 400 lines', () => {
    expect(gateLineCount([], 400)).toEqual({ pass: true });
  });

  it('fails at 401 lines', () => {
    const result = gateLineCount([], 401);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('401');
  });

  it('fails for new route.ts', () => {
    const changes = [{ filePath: 'src/app/api/foo/route.ts', status: 'added' }];
    const result = gateLineCount(changes, 10);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('route/page/layout');
  });

  it('fails for new page.tsx', () => {
    const changes = [{ filePath: 'src/app/foo/page.tsx', status: 'added' }];
    const result = gateLineCount(changes, 10);
    expect(result.pass).toBe(false);
  });

  it('passes for modified route.ts (not added)', () => {
    const changes = [{ filePath: 'src/app/api/foo/route.ts', status: 'modified' }];
    expect(gateLineCount(changes, 10)).toEqual({ pass: true });
  });
});

describe('gateContentBans', () => {
  it('passes on clean lines', () => {
    expect(gateContentBans(['const x = 1;', 'return y;'])).toEqual({ pass: true });
  });

  it('fails on process.env', () => {
    const result = gateContentBans(['const x = process.env.FOO;']);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('process.env');
  });

  it('fails on fetch(', () => {
    const result = gateContentBans(['await fetch(url)']);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('fetch(');
  });

  it('fails on .insert(', () => {
    const result = gateContentBans(['db.insert({ x: 1 })']);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('.insert(');
  });

  it('fails on @ts-ignore', () => {
    const result = gateContentBans(['// @ts-ignore']);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('@ts-ignore');
  });

  it('fails on a forced type cast pattern', () => {
    const castLine = 'x ' + ['as', 'unknown', 'as'].join(' ') + ' Foo';
    const result = gateContentBans([castLine]);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain(['as', 'unknown', 'as'].join(' '));
  });

  it('fails on a TypeScript any annotation', () => {
    const result = gateContentBans(['const x: any = 1;']);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('typescript any');
  });

  it('passes for variable named anything', () => {
    expect(gateContentBans(['const anything = 1;']).pass).toBe(true);
  });

  it('passes for any in a comment without colon', () => {
    expect(gateContentBans(['// any comment here']).pass).toBe(true);
  });

  it('fails on writeFileSync', () => {
    const result = gateContentBans(['fs.writeFileSync("x", data)']);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('writeFileSync');
  });

  it('fails on exec(', () => {
    const result = gateContentBans(['child_process.exec("ls")']);
    expect(result.pass).toBe(false);
  });

  it('fails on spawn(', () => {
    const result = gateContentBans(['const p = spawn("node", [])']);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('spawn(');
  });

  it('fails on as any cast', () => {
    const result = gateContentBans(['const x = foo ' + ['as', 'any'].join(' ')]);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain(['as', 'any'].join(' '));
  });

  it('fails on fetch with space before paren', () => {
    const result = gateContentBans(['await fetch ("http://evil.com")']);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('fetch (');
  });

  it('catches execSync standalone', () => {
    const result = gateContentBans(['const out = execSync("ls")']);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('execSync');
  });

  it('exports CONTENT_BANS', () => {
    expect(CONTENT_BANS.length).toBeGreaterThanOrEqual(22);
  });
});

describe('gateVerifyCommands', () => {
  const ok = () => ({ valid: true });

  it('passes for valid commands', () => {
    expect(gateVerifyCommands(['npm test -- a.ts'], ['a.ts'], ok)).toEqual({ pass: true });
  });

  it('fails for empty array', () => {
    expect(gateVerifyCommands([], [], ok).pass).toBe(false);
  });

  it('fails for invalid command', () => {
    const validator = () => ({ valid: false, reason: 'bad path' });
    const result = gateVerifyCommands(['npm run build'], [], validator);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('bad path');
  });
});

describe('gateCostCap', () => {
  it('passes at $0.50', () => {
    expect(gateCostCap(0.50)).toEqual({ pass: true });
  });

  it('fails at $0.51', () => {
    const result = gateCostCap(0.51);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('exceeds');
  });

  it('fails on NaN', () => {
    expect(gateCostCap(NaN).pass).toBe(false);
  });

  it('fails on negative', () => {
    expect(gateCostCap(-1).pass).toBe(false);
  });
});

describe('gateSecretScan', () => {
  it('passes on clean text', () => {
    expect(gateSecretScan(['hello world']).pass).toBe(true);
  });

  it('fails on an OpenAI-style key', () => {
    expect(gateSecretScan(['sk-proj-' + 'a'.repeat(20)]).pass).toBe(false);
  });

  it('fails on a ghp_ token', () => {
    expect(gateSecretScan(['ghp_' + 'A'.repeat(20)]).pass).toBe(false);
  });

  it('fails on a github_pat_ token', () => {
    expect(gateSecretScan(['github_pat_' + 'B'.repeat(20)]).pass).toBe(false);
  });

  it('fails on a JWT', () => {
    expect(gateSecretScan(['eyJ' + 'a'.repeat(20)]).pass).toBe(false);
  });

  it('passes on a git SHA (40 hex chars)', () => {
    expect(gateSecretScan(['a'.repeat(40)]).pass).toBe(true);
  });

  it('passes on a content hash (64 hex chars)', () => {
    expect(gateSecretScan(['a'.repeat(64)]).pass).toBe(true);
  });

  it('passes on a short random string (< 40 chars)', () => {
    expect(gateSecretScan(['abcdef1234567890abcdef']).pass).toBe(true);
  });
});

describe('runAllGates', () => {
  const baseInput = () => ({
    hashBefore: new Map<string, string>(),
    hashAfter: new Map<string, string>([['src/lib/pm-todo/a.ts', 'h1']]),
    allowedFiles: ['src/lib/pm-todo/a.ts'],
    isInAllowlist: () => true,
    classifyRisk: () => ({ risk: 'B' }),
    totalAddedLines: 10,
    addedLines: ['const x = 1;'],
    verifyCommands: ['npm test -- a.test.ts'],
    validateVerifyCommand: () => ({ valid: true }),
    costUsd: 0.1,
    outboundTexts: ['clean text'],
  });

  it('passes when all gates pass', () => {
    expect(runAllGates(baseInput())).toEqual({ pass: true });
  });

  it('returns the first failing gate', () => {
    const input = baseInput();
    input.isInAllowlist = () => false;
    const result = runAllGates(input);
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('allowedFiles');
    expect(result.reason).toContain('src/lib/pm-todo/a.ts');
  });

  it('returns a later failing gate when earlier gates pass', () => {
    const input = baseInput();
    input.costUsd = 5;
    const result = runAllGates(input);
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('costCap');
  });
});
