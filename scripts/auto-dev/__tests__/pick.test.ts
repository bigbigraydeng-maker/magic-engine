import { describe, expect, it } from 'vitest';

import { isValidPriority, parseSections, pickIssues } from '../pick.mjs';

const COMPLETE_BODY = [
  '## 目标',
  '让 pm-todo 支持新功能',
  '',
  '## 验收',
  '单元测试通过',
  '',
  '## 允许改的文件',
  '- src/lib/pm-todo/foo.ts',
  '- src/lib/pm-todo/bar.ts',
  '',
  '## 不做',
  '不改数据库',
  '',
  '## 验证命令',
  '- npm test -- src/lib/pm-todo/__tests__/foo.test.ts',
  '',
  '## 优先级',
  'P2 - 频率高 / IMPACT 中 / 收入低',
].join('\n');

describe('parseSections', () => {
  it('parses a complete body', () => {
    const result = parseSections(COMPLETE_BODY);
    expect(result.complete).toBe(true);
    expect(result.goal).toBe('让 pm-todo 支持新功能');
    expect(result.acceptance).toBe('单元测试通过');
    expect(result.notDoing).toBe('不改数据库');
    expect(result.priority).toBe('P2 - 频率高 / IMPACT 中 / 收入低');
    expect(result.allowedFiles).toEqual(['src/lib/pm-todo/foo.ts', 'src/lib/pm-todo/bar.ts']);
    expect(result.verifyCommands).toEqual(['npm test -- src/lib/pm-todo/__tests__/foo.test.ts']);
  });

  it('returns complete false when sections are missing', () => {
    const result = parseSections('## 目标\n只有目标');
    expect(result.complete).toBe(false);
    expect(result.acceptance).toBeNull();
    expect(result.allowedFiles).toBeNull();
  });

  it('returns all nulls for empty body', () => {
    const result = parseSections('');
    expect(result.complete).toBe(false);
    expect(result.goal).toBeNull();
    expect(result.allowedFiles).toBeNull();
  });

  it('parses allowedFiles from list format', () => {
    const result = parseSections(COMPLETE_BODY);
    expect(result.allowedFiles).toHaveLength(2);
    expect(result.allowedFiles?.[0]).toBe('src/lib/pm-todo/foo.ts');
  });
});

describe('isValidPriority', () => {
  it('accepts P2 with scoring', () => {
    expect(isValidPriority('P2 - 频率高 / IMPACT 中 / 收入低')).toBe(true);
  });

  it('rejects P1', () => {
    expect(isValidPriority('P1')).toBe(false);
  });

  it('rejects P2 without scoring', () => {
    expect(isValidPriority('P2')).toBe(false);
  });
});

type Issue = { number: number; author: string; labels: string[]; body: string };
type LabelEvent = { label: string; actor: string };

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 1,
    author: 'bigbigraydeng-maker',
    labels: ['auto-dev'],
    body: COMPLETE_BODY,
    ...overrides,
  };
}

function makeLabelEvents(issueNumber: number, actor = 'bigbigraydeng-maker'): Map<number, LabelEvent[]> {
  return new Map([[issueNumber, [{ label: 'auto-dev', actor }]]]);
}

function makeInput(issue: Issue, overrides: {
  labelEvents?: Map<number, LabelEvent[]>;
  openPrFiles?: Map<number, string[]>;
  trunkImporters?: (filePath: string) => string[];
  classifyRisk?: (opts: { files: Array<{ filename: string; status: string }> }) => { risk: string };
} = {}) {
  return {
    issues: [issue],
    labelEvents: overrides.labelEvents ?? makeLabelEvents(issue.number),
    openPrFiles: overrides.openPrFiles ?? new Map<number, string[]>(),
    trunkImporters: overrides.trunkImporters ?? (() => ['src/lib/pm-todo/consumer.ts']),
    classifyRisk: overrides.classifyRisk ?? (() => ({ risk: 'B' })),
  };
}

describe('pickIssues', () => {
  it('skips untrusted author', () => {
    const issue = makeIssue({ author: 'random-user' });
    const result = pickIssues(makeInput(issue));
    expect(result[0]).toEqual({ number: 1, skip: true, reason: '作者不在可信名单' });
  });

  it('skips untrusted labeler', () => {
    const issue = makeIssue();
    const result = pickIssues(makeInput(issue, { labelEvents: makeLabelEvents(1, 'random-user') }));
    expect(result[0]).toEqual({ number: 1, skip: true, reason: 'auto-dev 标签不是可信作者贴的' });
  });

  it('skips in-progress label', () => {
    const issue = makeIssue({ labels: ['auto-dev', 'auto-dev:in-progress'] });
    const result = pickIssues(makeInput(issue));
    expect(result[0]).toEqual({ number: 1, skip: true, reason: '标签状态不符' });
  });

  it('skips incomplete body', () => {
    const issue = makeIssue({ body: '## 目标\n只有目标' });
    const result = pickIssues(makeInput(issue));
    expect(result[0]).toEqual({ number: 1, skip: true, reason: '正文 6 段不齐全' });
  });

  it('skips A-level file', () => {
    const issue = makeIssue();
    const result = pickIssues(makeInput(issue, { classifyRisk: () => ({ risk: 'A' }) }));
    expect(result[0]).toEqual({ number: 1, skip: true, reason: '文件数超限或含 A 级文件' });
  });

  it('skips file outside allowlist', () => {
    const body = COMPLETE_BODY.replace('src/lib/pm-todo/foo.ts', 'src/app/page.tsx');
    const issue = makeIssue({ body });
    const result = pickIssues(makeInput(issue));
    expect(result[0]).toEqual({ number: 1, skip: true, reason: '文件不在白名单或引用方在白名单外' });
  });

  it('skips referrer outside allowlist', () => {
    const issue = makeIssue();
    const result = pickIssues(makeInput(issue, {
      trunkImporters: () => ['src/app/api/workbench/today/route.ts'],
    }));
    expect(result[0]).toEqual({ number: 1, skip: true, reason: '文件不在白名单或引用方在白名单外' });
  });

  it('skips invalid verify command', () => {
    const body = COMPLETE_BODY.replace(
      'npm test -- src/lib/pm-todo/__tests__/foo.test.ts',
      'npm run build',
    );
    const issue = makeIssue({ body });
    const result = pickIssues(makeInput(issue));
    expect(result[0]).toMatchObject({
      number: 1,
      skip: true,
      reason: expect.stringContaining('验证命令不合规'),
    });
  });

  it('skips file overlap with open PR', () => {
    const issue = makeIssue();
    const openPrFiles = new Map([[99, ['src/lib/pm-todo/foo.ts']]]);
    const result = pickIssues(makeInput(issue, { openPrFiles }));
    expect(result[0]).toEqual({ number: 1, skip: true, reason: '有未合并 PR 改到同一文件' });
  });

  it('skips production keyword in acceptance', () => {
    const body = COMPLETE_BODY.replace('单元测试通过', '需要在生产环境验证');
    const issue = makeIssue({ body });
    const result = pickIssues(makeInput(issue));
    expect(result[0]).toEqual({ number: 1, skip: true, reason: '验收条件含生产/外部依赖' });
  });

  it('picks a valid issue', () => {
    const issue = makeIssue();
    const result = pickIssues(makeInput(issue));
    expect(result).toEqual([{ number: 1 }]);
  });

  it('picks only first 2 of 3 valid issues', () => {
    const issues = [makeIssue({ number: 1 }), makeIssue({ number: 2 }), makeIssue({ number: 3 })];
    const labelEvents = new Map<number, LabelEvent[]>([
      [1, [{ label: 'auto-dev', actor: 'bigbigraydeng-maker' }]],
      [2, [{ label: 'auto-dev', actor: 'bigbigraydeng-maker' }]],
      [3, [{ label: 'auto-dev', actor: 'bigbigraydeng-maker' }]],
    ]);
    const result = pickIssues({
      issues,
      labelEvents,
      openPrFiles: new Map<number, string[]>(),
      trunkImporters: () => ['src/lib/pm-todo/consumer.ts'],
      classifyRisk: () => ({ risk: 'B' }),
    });
    expect(result).toEqual([
      { number: 1 },
      { number: 2 },
      { number: 3, skip: true, reason: '本轮已满 2 张' },
    ]);
  });
});
