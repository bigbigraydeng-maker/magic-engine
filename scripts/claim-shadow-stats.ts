/**
 * 影子统计 CLI —— 只读,不联网、不读环境变量、不碰数据库、不写盘。
 *
 * 用法:
 *   npx tsx scripts/claim-shadow-stats.ts rows.json
 *
 * rows.json 是一个 JSON 数组,元素形如 {id, source, text},由只读 SQL 查询导出
 * (见 docs/audits)。脚本只读这一个本地文件,把 formatShadowReport(...) 打到 stdout。
 */

import { readFileSync } from 'node:fs'
import {
  compareClaimRules,
  formatShadowReport,
  type ShadowRow,
} from '../src/lib/content/claim-shadow-stats'

const USAGE = '用法: npx tsx scripts/claim-shadow-stats.ts rows.json\n'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRows(raw: string): ShadowRow[] {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('rows.json 顶层必须是数组')
  }

  const rows: ShadowRow[] = []
  for (let i = 0; i < parsed.length; i += 1) {
    const element: unknown = parsed[i]
    if (!isRecord(element)) {
      throw new Error(`第 ${i} 项不是对象`)
    }
    const { id, source, text } = element
    if (typeof id !== 'string') {
      throw new Error(`第 ${i} 项的 id 必须是字符串`)
    }
    if (typeof source !== 'string') {
      throw new Error(`第 ${i} 项的 source 必须是字符串`)
    }
    if (typeof text !== 'string' && text !== null) {
      throw new Error(`第 ${i} 项的 text 必须是字符串或 null`)
    }
    rows.push({ id, source, text })
  }
  return rows
}

function main(): void {
  const path = process.argv[2]
  if (typeof path !== 'string' || path.length === 0) {
    process.stderr.write(USAGE)
    process.exitCode = 1
    return
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`读取 ${path} 失败:${message}\n`)
    process.exitCode = 1
    return
  }

  let rows: ShadowRow[]
  try {
    rows = parseRows(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`解析 ${path} 失败:${message}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(formatShadowReport(compareClaimRules(rows)))
}

main()
