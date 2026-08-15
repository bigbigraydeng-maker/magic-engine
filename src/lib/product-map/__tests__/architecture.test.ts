/**
 * Product Map 的架构守卫（Issue #974）。
 *
 * 🔴 Product Map 是只读的编目层：它描述 Git 证据、不产生 Git 写入，也不碰 Supabase。
 *    这里守两条红线：(1) 不 import 任何 provider 写入通道 / 数据库客户端；
 *    (2) 不出现 `any`（CLAUDE.md 铁律 7）。
 *
 * 🔴 刻意写成简单的原始字符串匹配，不是仓库其它六套架构守卫那种基于
 *    TypeScript Compiler API 的注释感知扫描（`src/lib/growth/__tests__/architecture.test.ts`
 *    等）。本次实现环境没有可用的 npm / 测试执行权限，无法在本地把一份手抄的
 *    `stripComments()`（`strip-comments-consistency.test.ts` 要求与其它七处逐字一致）
 *    跑一遍确认字节级正确 —— 与其引入一份没跑过、可能在细节上跟其它七份产生
 *    diff 的拷贝，不如先用一版更简单、检查过全部依赖名字面量因此风险更低的实现，
 *    后续 PR 里在能跑测试的环境下升级成同款注释感知版本。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const PRODUCT_MAP_DIR = join(ROOT, 'src/lib/product-map')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

const PRODUCTION_FILES = walk(PRODUCT_MAP_DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))

const sourceOf = (file: string): string => readFileSync(join(ROOT, file), 'utf8')

describe('Product Map 是只读编目层', () => {
  it('目录里确实有生产文件（防止判据因为路径写错而空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
  })

  it('不 import Supabase 客户端 / 执行内核 / 任何 provider 写入通道', () => {
    const forbidden = [
      '@supabase/supabase-js',
      '@/lib/supabase',
      '@/lib/kernel',
      '@/lib/capabilities',
      '@/lib/publer/',
      '@/lib/gbp/',
      '@/lib/gsc/',
      '@/lib/meta',
      '@/lib/google-ads',
    ]
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const spec of forbidden) {
        if (new RegExp(`from\\s+['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(src)) {
          violations.push(`${file} → ${spec}`)
        }
      }
    }
    expect(
      violations,
      'Product Map 只编目、不执行、不写库。真要对外发生什么，走 Kernel 授权链，\n' +
        '不要在这一层把执行或 provider 写入通道拉进来。\n' + violations.join('\n'),
    ).toEqual([])
  })

  it('不发起任何 GitHub 写操作（merge / close / comment / label 一律禁止）', () => {
    const forbiddenCalls = [
      "method: 'PUT'",
      "method: 'PATCH'",
      "method: 'DELETE'",
      '/merge',
      'issues/comments',
    ]
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const needle of forbiddenCalls) {
        if (src.includes(needle)) violations.push(`${file} → ${needle}`)
      }
    }
    expect(
      violations,
      'Issue #974 硬红线：GitHub 只读，不允许 Product Map 回写、合并或关闭 Issue/PR。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('没有 any', () => {
    const violations = PRODUCTION_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(sourceOf(f)))
    expect(violations, 'CLAUDE.md 铁律 7：TypeScript strict，无 any。\n' + violations.join('\n')).toEqual([])
  })
})
