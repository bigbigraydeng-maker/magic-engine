/**
 * Growth 契约的架构守卫（Issue #877 / WP01）。
 *
 * 🔴 为什么不只靠 code review：这个模块的全部价值就是「它什么都不做」。
 *    一旦有人在这里 import 了执行内核、看板或某个 provider 客户端，
 *    契约层就变成了又一条绕过授权的路 —— 而那种改动在 diff 里长得很无辜。
 *
 * 判据写在本文件内，刻意**不**为测试单独建一份生产侧边界清单。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const GROWTH_DIR = join(ROOT, 'src/lib/growth')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * 扫描前先去掉注释。
 *
 * 🔴 不去的话，**解释这条规则的注释本身**会被当成罪证（kernel 的架构测试
 *    踩过这个坑）—— 一条把自己的文档当违规的规则，第一件事就是教人删注释。
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

/** 生产文件 = growth 目录下除测试以外的 .ts。 */
const PRODUCTION_FILES = walk(GROWTH_DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))

const sourceOf = (file: string): string => stripComments(readFileSync(join(ROOT, file), 'utf8'))

describe('Growth 契约是纯的', () => {
  it('契约目录里确实有生产文件（防止判据因为路径写错而空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
  })

  it('不 import 执行内核 / 看板 / 数据库 / 任何 provider 通道', () => {
    const forbidden = [
      '@/lib/kernel',
      '@/lib/zhuge',
      '@/lib/execution',
      '@/lib/capabilities',
      '@/lib/supabase',
      // 🔴 指标引用刻意不绑既有归因词汇表（GEO 契约 §5 末段：不许假定同名即同义）。
      //    这条是最容易被下一个人「顺手改进」掉的红线，所以给它一道机器守卫。
      '@/lib/flywheel',
      '@supabase/supabase-js',
      '@/lib/cms/',
      '@/lib/publer/',
      '@/lib/gbp/',
      '@/lib/gsc/',
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
      'Growth 契约只描述形状。要让系统做事，提交一个 action_run 交给执行内核，\n' +
        '不要在契约层把执行、看板或 provider 通道拉进来。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('不提及看板写入、legacy 动作类型或授权账本的符号', () => {
    const forbidden = [
      'writeExecutionItems',
      'execution_items',
      'PriorityAction',
      'supabaseAdmin',
      'action_runs',
      "'superseded'",
      // 指标引用是一个自由的非空字符串，绑上封闭的归因词汇表就等于宣布语义等价。
      'FlywheelMetricKey',
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
      '这些符号各自代表一条 WP00 明令不走的路（§6 / §7.1 / §5.3）。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('门面不导出任何修改器 —— 证据与候选都是不可变的', () => {
    const exported = Array.from(
      sourceOf('src/lib/growth/index.ts').matchAll(/\b(validate|create|update|mutate|merge|upsert|persist|save|write|delete)[A-Z]\w*/g),
    ).map((m) => m[0])

    const mutators = exported.filter((name) => !name.startsWith('validate'))
    expect(
      mutators,
      'WP01 只导出类型与纯校验器。任何写入 / 变更语义都不属于契约层。',
    ).toEqual([])
  })

  it('没有 any', () => {
    const violations = PRODUCTION_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(sourceOf(f)))
    expect(violations, 'CLAUDE.md 铁律 7：TypeScript strict，无 any。\n' + violations.join('\n')).toEqual([])
  })
})
