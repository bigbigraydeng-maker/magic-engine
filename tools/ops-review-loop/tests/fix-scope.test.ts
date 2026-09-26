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
  PROTECTED_PATHS,
  checkFixScope,
  isGuardedBranch,
  protectionFor,
} from '../src/fix-scope.mjs'
import { classifyFile } from '../src/risk.mjs'

const LANE = `${GUARDED_BRANCH_PREFIXES[0]}whatever`
const file = (filename: string, additions = 1, deletions = 0) => ({ filename, additions, deletions })

describe('the guard only applies to the lane the auto-fix leg can push to', () => {
  it('applies on the lane', () => {
    expect(isGuardedBranch(LANE)).toBe(true)
    expect(checkFixScope({ branch: LANE, files: [file('src/lib/foo.ts')] }).applies).toBe(true)
  })

  it('does not apply elsewhere — humans keep working normally', () => {
    for (const branch of ['main', 'docs/whatever', 'fix/issue-939', 'feat/issue-939']) {
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
    ['碰根目录凭证变体', '.env.production'],
    ['改忽略清单放密钥进仓库', '.gitignore'],
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

// 魏征 W71-1 (#2071): this list still had the old `includes: '/.env.'` rule
// after risk.mjs was fixed, so root `.env.production` was blocked by one guard
// and not the other. One sample path per rule; every sample must be caught
// here AND rate A in risk.mjs, and every rule must be hit by some sample.
describe('the auto-fix denylist never falls out of step with the A rating', () => {
  const SAMPLES = [
    '.github/workflows/anything.yml',
    'tools/ops-review-loop/src/plan.mjs',
    'tools/ai-orchestrator/src/index.ts',
    'supabase/migrations/20260101000000_x.sql',
    'render.yaml',
    'src/lib/kernel/boundaries.ts',
    'src/lib/kernel/outward-authorization.ts',
    '.env',
    '.env.production',
    '.gitignore',
  ]

  it.each(SAMPLES)('%s is protected here and rated A there', (path) => {
    expect(protectionFor(path), path).toBeDefined()
    expect(classifyFile(path).risk, path).toBe('A')
  })

  it('every protected-path rule is exercised by a sample above', () => {
    const hit = new Set(SAMPLES.map((path) => protectionFor(path)))
    const unhit = PROTECTED_PATHS.filter((rule) => !hit.has(rule))
    expect(unhit.map((rule) => rule.why)).toEqual([])
  })

  it('keeps the root .env.example template and env-looking source files out', () => {
    for (const path of ['.env.example', 'src/lib/environment.ts', 'src/env-helpers.ts']) {
      expect(protectionFor(path), path).toBeUndefined()
    }
  })
})
