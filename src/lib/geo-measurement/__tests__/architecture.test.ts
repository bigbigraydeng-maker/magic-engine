/**
 * GEO Measurement 契约的架构守卫（Issue #876 / WP02）。
 *
 * 🔴 为什么不只靠 code review：这个模块的全部价值就是「它什么都不做」。
 *    一旦有人在这里 import 了执行内核、Kernel、DB 客户端或某个 provider，
 *    契约层就变成了又一条绕过治理的路 —— 而那种改动在 diff 里长得很无辜。
 *
 * 判据写在本文件内，仿 `src/lib/growth/__tests__/architecture.test.ts` 的写法，
 * 刻意不为测试单独建一份生产侧边界清单。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const GEO_MEASUREMENT_DIR = join(ROOT, 'src/lib/geo-measurement')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * 扫描前先去掉注释 —— 否则解释这条规则的注释本身会被当成罪证
 * （growth 的架构测试踩过这个坑）。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')
}

/** 生产文件 = geo-measurement 目录下除测试以外的 .ts。 */
const PRODUCTION_FILES = walk(GEO_MEASUREMENT_DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))

const sourceOf = (file: string): string => stripComments(readFileSync(join(ROOT, file), 'utf8'))

describe('GEO Measurement 契约是纯的', () => {
  it('契约目录里确实有生产文件（防止判据因为路径写错而空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
  })

  it('不 import 执行内核 / Kernel / 数据库 / provider 通道 / growth 契约', () => {
    const forbidden = [
      '@/lib/kernel',
      '@/lib/zhuge',
      '@/lib/execution',
      '@/lib/capabilities',
      '@/lib/supabase',
      '@/lib/flywheel',
      // 🔴 v1 实施授权明令：不 import growth —— 两份契约平行冻结，不许互相扩展。
      '@/lib/growth',
      '@supabase/supabase-js',
      '@/lib/cms/',
      '@/lib/publer/',
      '@/lib/gbp/',
      '@/lib/gsc/',
      '@/lib/ai-tracker/',
      '@/lib/industry-ai-visibility/',
      '@/lib/ai/',
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
      'GEO Measurement 契约只描述形状、判据与只读投影。legacy 行由调用方取好传入，\n' +
        '本模块不查库、不调用 provider、不 import growth 或任何执行/授权通道。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('不提及授权账本、legacy 动作类型或看板写入的符号', () => {
    const forbidden = [
      'writeExecutionItems',
      'execution_items',
      'PriorityAction',
      'supabaseAdmin',
      'action_runs',
      "'superseded'",
    ]
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const symbol of forbidden) {
        if (src.includes(symbol)) violations.push(`${file} → ${symbol}`)
      }
    }
    expect(
      violations,
      '这些符号各自代表一条契约明令不走的路。\n' + violations.join('\n'),
    ).toEqual([])
  })

  it('门面不导出任何修改器 —— 观测与证据都是不可变的', () => {
    const exported = Array.from(
      sourceOf('src/lib/geo-measurement/index.ts').matchAll(
        /\b(validate|create|update|mutate|merge|upsert|persist|save|write|delete)[A-Z]\w*/g,
      ),
    ).map((m) => m[0])

    const mutators = exported.filter((name) => !name.startsWith('validate'))
    expect(
      mutators,
      'WP02 只导出类型、纯校验器、纯可比性判定与纯 legacy 映射函数。任何写入 / 变更语义都不属于契约层。',
    ).toEqual([])
  })

  it('没有 any', () => {
    const violations = PRODUCTION_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(sourceOf(f)))
    expect(violations, 'CLAUDE.md 铁律 7：TypeScript strict，无 any。\n' + violations.join('\n')).toEqual([])
  })

  it('不出现网络 / 文件系统 / 定时任务相关调用', () => {
    const forbidden = ['fetch(', 'readFileSync', 'writeFileSync', 'setInterval', 'setTimeout', 'cron']
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const symbol of forbidden) {
        if (src.includes(symbol)) violations.push(`${file} → ${symbol}`)
      }
    }
    expect(
      violations,
      'GEO Measurement 契约是纯 TypeScript 类型/校验/判定/映射，没有任何运行时副作用。\n' +
        violations.join('\n'),
    ).toEqual([])
  })
})
