import { describe, expect, it } from 'vitest'

import {
  bodySignals,
  changedCodeHasTests,
  collectObservedSignals,
  isTestFile,
  noUnexplainedDependency,
  observedSpecializedEvidence,
} from '../src/evidence.mjs'

describe('bodySignals', () => {
  it('returns nothing for an empty or missing body', () => {
    expect(bodySignals('')).toEqual([])
    expect(bodySignals(null)).toEqual([])
    expect(bodySignals(undefined)).toEqual([])
  })

  it.each([
    ['linked-issue', 'Closes #1210'],
    ['linked-issue', 'see #42 for context'],
    ['acceptance-criteria', '验收条件：全部通过'],
    ['acceptance-criteria', 'Acceptance Criteria met'],
    ['scope-statement', '明确不做：不动 kernel'],
    ['scope-statement', 'Out of scope: migrations'],
    ['reuse-statement', '## Reuse Statement'],
    ['reuse-statement', '复用声明如下'],
    ['failure-handling', '失败处理：fail-closed'],
    ['failure-handling', 'fail-closed on read errors'],
    ['observability', '失败会被谁发现：cron 日志'],
    ['observability', 'observability: logged to console'],
    ['build-evidence', 'npm run build 通过'],
    ['build-evidence', 'build succeeded'],
    ['build-evidence', '`npm run build`：在非敏感占位 Supabase 环境变量下成功'],
    ['build-evidence', '473/473 build steps green'],
    ['test-output', 'npx vitest run tools/ops-review-loop 全绿'],
    ['test-output', 'npm test output attached, all passed'],
    ['test-output', '`npx vitest run tools/ops-review-loop --reporter=verbose`：473/473'],
  ])('detects %s from matching text', (id, text) => {
    expect(bodySignals(text)).toContain(id)
  })

  it('does not detect a signal from unrelated prose', () => {
    expect(bodySignals('This PR renames a variable.')).toEqual([])
  })

  // Codex finding (PR #1211, P2): these two signals used to match on the
  // command name alone, so a PR could earn the same 5 points for a build/test
  // command it explicitly says did NOT pass. On a C-level PR (75-point
  // threshold) that is 10 free points — enough on its own to turn a BLOCKED
  // into a READY.
  it.each([
    ['build-evidence', 'npm run build 未运行'],
    ['build-evidence', 'npm run build 失败'],
    ['build-evidence', '`npm run build`（待执行）'],
    ['build-evidence', 'npm run build: not run'],
    ['build-evidence', 'build failed'],
    ['build-evidence', 'npm run build: cancelled'],
    ['test-output', '测试命令：npx vitest（待执行）'],
    ['test-output', 'npx vitest run tools/ops-review-loop 失败'],
    ['test-output', 'npm test: cancelled'],
    ['test-output', 'vitest run — tests pending'],
    ['test-output', 'npm test: 3 tests failed, rest skipped'],
  ])('does NOT detect %s from a non-passing or unrun claim: %s', (id, text) => {
    expect(bodySignals(text)).not.toContain(id)
  })
})

describe('isTestFile / changedCodeHasTests', () => {
  it.each(['src/foo.test.ts', 'src/foo.test.tsx', 'src/foo.spec.ts', 'src/__tests__/foo.ts'])(
    'recognises %s as a test file',
    (path) => {
      expect(isTestFile(path)).toBe(true)
    },
  )

  it('does not treat an ordinary source file as a test file', () => {
    expect(isTestFile('src/foo.ts')).toBe(false)
  })

  it('is true only when the diff has both a test file and a non-test file', () => {
    expect(changedCodeHasTests([{ filename: 'src/foo.ts' }, { filename: 'src/foo.test.ts' }])).toBe(true)
  })

  it('is false for a test-only diff', () => {
    expect(changedCodeHasTests([{ filename: 'src/foo.test.ts' }])).toBe(false)
  })

  it('is false for a code-only diff', () => {
    expect(changedCodeHasTests([{ filename: 'src/foo.ts' }])).toBe(false)
  })

  it('is false when the file list is unreadable', () => {
    expect(changedCodeHasTests(null)).toBe(false)
    expect(changedCodeHasTests(undefined)).toBe(false)
  })
})

describe('noUnexplainedDependency', () => {
  it('is true when no manifest file is touched', () => {
    expect(noUnexplainedDependency([{ filename: 'src/foo.ts' }], '')).toBe(true)
  })

  it('is false when package.json is touched with no explanation', () => {
    expect(noUnexplainedDependency([{ filename: 'package.json' }], 'bumped a version')).toBe(false)
  })

  it('is true when package-lock.json is touched and the body explains why', () => {
    expect(
      noUnexplainedDependency([{ filename: 'package-lock.json' }], '新增依赖 js-yaml：workflow YAML 解析需要'),
    ).toBe(true)
  })
})

describe('collectObservedSignals', () => {
  it('adds only the signals the facts actually support', () => {
    const signals = collectObservedSignals({
      prBody: 'Closes #1 — 验收条件：全部通过',
      files: [{ filename: 'src/foo.ts' }],
      requiredCiPassed: true,
      scopeGuardPassed: false,
      riskRated: true,
      specializedEvidenceComplete: false,
    })
    expect(signals).toContain('linked-issue')
    expect(signals).toContain('acceptance-criteria')
    expect(signals).toContain('required-ci-green')
    expect(signals).toContain('risk-rated')
    expect(signals).toContain('no-unexplained-dependency')
    expect(signals).not.toContain('scope-guard-green')
    expect(signals).not.toContain('specialized-evidence-complete')
    expect(signals).not.toContain('changed-code-has-tests')
  })

  it('returns an empty-ish list for a bare call with no facts', () => {
    // no-unexplained-dependency is still true (nothing touched a manifest).
    expect(collectObservedSignals()).toEqual(['no-unexplained-dependency'])
  })
})

describe('observedSpecializedEvidence', () => {
  const required = [{ category: 'control-plane', id: 'control-plane-evidence', label: 'x' }]

  it('counts a checked item naming the exact evidence id', () => {
    const body = '## 专项证据\n- [x] 控制面证据 (control-plane-evidence): 已验证 fail-closed'
    expect(observedSpecializedEvidence(body, required)).toEqual(['control-plane-evidence'])
  })

  it('does not count an unchecked item', () => {
    const body = '- [ ] 控制面证据 (control-plane-evidence): 待补'
    expect(observedSpecializedEvidence(body, required)).toEqual([])
  })

  it('does not count the id merely appearing in prose', () => {
    const body = 'This PR touches control-plane-evidence somewhere in the code.'
    expect(observedSpecializedEvidence(body, required)).toEqual([])
  })

  it('returns nothing for a missing body', () => {
    expect(observedSpecializedEvidence(undefined, required)).toEqual([])
  })

  it('ignores an entry with no usable id', () => {
    // id: 42 is a deliberately illegal runtime value (the contract says
    // `id: string`) — cast through `unknown` to bypass the compile-time
    // contract without widening the production signature.
    expect(
      observedSpecializedEvidence('- [x] whatever (x)', [{ id: '' }, { id: 42 as unknown as string }]),
    ).toEqual([])
  })
})
