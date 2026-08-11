/**
 * GEO Measurement Runtime 的架构守卫（Issue #874 / WP04）。
 *
 * 🔴 为什么不只靠 code review：这个 WP 授权的边界极窄——只证明
 *    `explicit plan → preflight → fake execution → validation → atomic fake-store → result`。
 *    一旦有人在这里悄悄接上 Kernel、真实 provider SDK、生产 Supabase 客户端、
 *    legacy 编排器的聚合/upsert，或者一条 cron/route，这个 WP 就从"最小证明"
 *    变成了绕过治理的路 —— 而那种改动在 diff 里长得很无辜。
 *
 * 判据写法仿 `src/lib/geo-measurement/__tests__/architecture.test.ts`（WP02）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const RUNTIME_DIR = join(ROOT, 'src/lib/geo-measurement-runtime')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

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

const PRODUCTION_FILES = walk(RUNTIME_DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))

const sourceOf = (file: string): string => stripComments(readFileSync(join(ROOT, file), 'utf8'))

describe('GEO Measurement Runtime 只做授权范围内的事', () => {
  it('运行时目录里确实有生产文件（防止判据因为路径写错而空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
  })

  it('不 import Kernel / 生产 Supabase / 真实 provider SDK / legacy 采集器 / growth 契约', () => {
    const forbidden = [
      '@/lib/kernel',
      '@/lib/zhuge',
      '@/lib/execution',
      '@/lib/capabilities',
      '@/lib/supabase',
      '@/lib/flywheel',
      '@/lib/growth',
      '@/lib/ai-tracker/',
      '@/lib/industry-ai-visibility/',
      '@/lib/ai/',
      '@/lib/dataforseo',
      '@supabase/supabase-js',
      'openai',
      '@anthropic-ai/sdk',
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
      'WP04 只证明 fake provider + fake store 的最小流水线。真实 provider、生产 Supabase、Kernel、\n' +
        'legacy 采集器聚合/upsert 都不属于本 WP 边界。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('不提及 Kernel 幂等账本 / 授权账本 / legacy 动作类型 / 看板写入符号', () => {
    const forbidden = [
      'computeIdempotencyKey',
      'action_runs',
      'writeExecutionItems',
      'execution_items',
      'PriorityAction',
      'supabaseAdmin',
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
      '这些符号各自代表一条本 WP 明令不走的路：Kernel 的 provider 幂等键不是这个模块的事，\n' +
        '内部 run/store 幂等不能被描述成 provider exactly-once。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('只依赖 WP02 契约 / WP03 行形状类型，不重新定义一套平行观测契约', () => {
    const forbidden = ['interface GeoObservation ', 'interface GeoEvidence ', 'interface GeoAcquisitionIdentity ']
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const symbol of forbidden) {
        if (src.includes(symbol)) violations.push(`${file} → 重新声明 "${symbol.trim()}"`)
      }
    }
    expect(
      violations,
      '观测/证据的契约形状由 WP02 冻结，WP04 只能 import，不能另建一套同名不同义的类型。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('没有 any', () => {
    const violations = PRODUCTION_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(sourceOf(f)))
    expect(violations, 'CLAUDE.md 铁律 7：TypeScript strict，无 any。\n' + violations.join('\n')).toEqual([])
  })

  it('不出现真实网络调用 / 文件系统 / 定时任务 / 生产路由入口', () => {
    const forbidden = ['fetch(', 'readFileSync', 'writeFileSync', 'setInterval', 'setTimeout', 'cron', 'NextResponse', 'NextRequest']
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const symbol of forbidden) {
        if (src.includes(symbol)) violations.push(`${file} → ${symbol}`)
      }
    }
    expect(
      violations,
      'WP04 本轮只交付一个可以单元测试的库边界，不暴露 cron/API/route（Build Control Room\n' +
        '2026-08-11 WP04 裁定：不暴露生产 cron/route/公开 API 入口）。\n' +
        violations.join('\n'),
    ).toEqual([])
  })
})
