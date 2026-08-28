/**
 * Issue #1073 组 G —— 死调试路由删除回归护栏。
 *
 * 这 7 个路由（`/api/diagnose` + 6 个 `/api/diagnostic/*`）是早期手测端点：
 * 无鉴权、硬编码 CTS clientId、`/api/diagnose` 在 GET 上会真的调用 OpenAI/Claude。
 * 全仓零调用方，非生产打分器（生产打分在 `/api/clients/[id]/diagnostic/*`）。
 * 详见 docs/specs/2026-08-19-ai-tracker-decommission-v1.md §4 组 G。
 *
 * 本测试锁两件事：删掉的路径不许再出现；活的消费方不许被这次删除误伤。
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()

describe('组 G 死路由已删除', () => {
  const deletedRoutes = [
    'src/app/api/diagnose/route.ts',
    'src/app/api/diagnostic/details/route.ts',
    'src/app/api/diagnostic/questions/route.ts',
    'src/app/api/diagnostic/response/route.ts',
    'src/app/api/diagnostic/results/route.ts',
    'src/app/api/diagnostic/parser-errors/route.ts',
    'src/app/api/diagnostic/verify-brands/route.ts',
  ]

  it.each(deletedRoutes)('%s 不存在', (relPath) => {
    expect(existsSync(join(ROOT, relPath))).toBe(false)
  })
})

describe('组 G 删除未误伤活消费方', () => {
  const liveFiles = [
    // 生产诊断打分器（非本轮删除对象，见组 F，归 P31.X.4）
    'src/app/api/clients/[id]/diagnostic/run/route.ts',
    'src/lib/diagnostic/ai-visibility-live-probe.ts',
    // 共享 runner，本轮不搬迁（见组 B）
    'src/lib/ai-tracker/runners/openai.ts',
    'src/lib/ai-tracker/parser.ts',
    // 系统 C（industry-ai-visibility），判决明确保留
    'src/lib/industry-ai-visibility/collector.ts',
    // 拓客分析，复用 runOpenAI
    'src/lib/prospecting/analyze.ts',
  ]

  it.each(liveFiles)('%s 仍存在', (relPath) => {
    expect(existsSync(join(ROOT, relPath))).toBe(true)
  })
})
