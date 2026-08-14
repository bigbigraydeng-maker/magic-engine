/**
 * The auto-fix blast-radius guard (PR #941, Codex's second finding).
 *
 * Codex's point was that prompt fencing cannot make a model refuse, and that
 * the earlier tests only proved untrusted text *sat inside* a fence — never
 * that it would not be obeyed. So these tests do not test wording at all.
 * They feed in the file lists a successfully-injected fix round would produce
 * and assert the guard rejects them.
 */

import { describe, expect, it } from 'vitest'

import {
  GUARDED_BRANCH_PREFIXES,
  MAX_CHANGED_FILES,
  MAX_CHANGED_LINES,
  checkFixScope,
  isGuardedBranch,
} from '../src/fix-scope.mjs'

const LANE = `${GUARDED_BRANCH_PREFIXES[0]}whatever`
const file = (filename: string, additions = 1, deletions = 0) => ({ filename, additions, deletions })

describe('the guard only applies to the lane the auto-fix leg can push to', () => {
  it('applies on the lane', () => {
    expect(isGuardedBranch(LANE)).toBe(true)
    expect(checkFixScope({ branch: LANE, files: [file('src/lib/foo.ts')] }).applies).toBe(true)
  })

  it('does not apply elsewhere — humans keep working normally', () => {
    for (const branch of ['main', 'docs/whatever', 'fix/issue-939', 'claude/not-me2']) {
      const r = checkFixScope({ branch, files: [file('.github/workflows/anything.yml')] })
      expect(r.applies, branch).toBe(false)
      expect(r.ok, branch).toBe(true)
    }
  })
})

describe('🔴 a successfully-injected fix round is stopped by what it changed', () => {
  // Each case is "the model was persuaded and did the thing" — the guard must
  // not care why.
  const attacks: Array<[label: string, path: string]> = [
    ['给自己放权（改工作流）', '.github/workflows/ops-codex-to-claude-fix.yml'],
    ['关掉这道闸门本身', '.github/workflows/ops-fix-scope-guard.yml'],
    ['改判自己命运的控制面', 'tools/ops-review-loop/src/plan.mjs'],
    ['改自己的轮次上限', 'tools/ops-review-loop/src/handle-review.mjs'],
    ['改编排控制面', 'tools/ai-orchestrator/whatever.ts'],
    ['偷改数据库结构', 'supabase/migrations/20260812000000_x.sql'],
    ['改生产服务 / cron', 'render.yaml'],
    ['放宽授权白名单', 'src/lib/kernel/boundaries.ts'],
    ['改对外动作授权', 'src/lib/kernel/outward-authorization.ts'],
    ['碰凭证文件', '.env'],
    ['碰嵌套凭证文件', 'apps/web/.env.production'],
  ]

  for (const [label, path] of attacks) {
    it(`拦住：${label}（${path}）`, () => {
      const r = checkFixScope({ branch: LANE, files: [file('src/lib/ok.ts'), file(path)] })
      expect(r.ok).toBe(false)
      expect(r.violations.join('\n')).toContain(path)
    })
  }

  it('拦住：一次改太多文件', () => {
    const files = Array.from({ length: MAX_CHANGED_FILES + 1 }, (_, i) => file(`src/lib/f${i}.ts`))
    const r = checkFixScope({ branch: LANE, files })
    expect(r.ok).toBe(false)
    expect(r.violations.join('\n')).toContain('超过上限')
  })

  it('拦住：一次改太多行', () => {
    const r = checkFixScope({ branch: LANE, files: [file('src/lib/a.ts', MAX_CHANGED_LINES, 1)] })
    expect(r.ok).toBe(false)
    expect(r.violations.join('\n')).toContain('行')
  })
})

describe('🔴 fail closed —— 「读不到」不许当成「没问题」', () => {
  it('空清单判失败', () => {
    const r = checkFixScope({ branch: LANE, files: [] })
    expect(r.applies).toBe(true)
    expect(r.ok).toBe(false)
  })

  it('不是数组判失败', () => {
    // @ts-expect-error deliberately malformed input
    expect(checkFixScope({ branch: LANE, files: null }).ok).toBe(false)
  })

  it('清单里有没名字的项判失败', () => {
    const r = checkFixScope({ branch: LANE, files: [{ filename: '' }] })
    expect(r.ok).toBe(false)
  })
})

describe('✅ 正常的修复不会被误杀', () => {
  it('改业务代码和测试是允许的', () => {
    const r = checkFixScope({
      branch: LANE,
      files: [file('src/lib/geo/foo.ts', 30, 4), file('src/lib/geo/__tests__/foo.test.ts', 60, 0)],
    })
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('路径只是长得像受保护项的不误杀', () => {
    const r = checkFixScope({
      branch: LANE,
      // not .github/workflows/, not tools/ops-review-loop/, not a .env file
      files: [file('docs/github/workflows.md'), file('src/lib/environment.ts'), file('src/env-helpers.ts')],
    })
    expect(r.ok).toBe(true)
  })
})
