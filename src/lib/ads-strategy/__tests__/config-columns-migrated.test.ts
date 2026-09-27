/**
 * 静态守卫：`config.ts` 从 `ad_strategy_configs` 读的每一列，仓库里都有 migration 建过它。
 *
 * 🔴 **它抓不住 2026-09-25 那次事故本身。** 那次的 migration 文件在仓库里，只是代码先上线、
 *    数据库晚一天才 apply —— 这是部署顺序问题，只能在运行时喊出来（见 route.ts 的 `ad_config`
 *    错误和今日待办 `ads_config_unreadable`）。这条守的是隔壁那种：列名拼错、或者加列的
 *    migration 根本没写，上线后同样是每次读 400、同样静默退回 fallback。
 *
 * 扫描前先去掉 SQL 注释 —— 注释里提到列名不算建过它。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations')
const CONFIG_SRC = readFileSync(join(ROOT, 'src/lib/ads-strategy/config.ts'), 'utf8')

function stripSqlComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

/** config.ts 里 `.from('ad_strategy_configs').select('…')` 选的列。找不到就抛，免得在空列表上恒绿。 */
function selectedColumns(): string[] {
  const m = CONFIG_SRC.match(/\.from\('ad_strategy_configs'\)\s*\.select\('([^']+)'\)/)
  if (!m) throw new Error("config.ts 里找不到 .from('ad_strategy_configs').select('…') —— 守卫需要跟着改")
  return m[1].split(',').map((c) => c.trim()).filter(Boolean)
}

/**
 * 按文件名顺序重放所有 migration 后，ad_strategy_configs 现有的列：
 * CREATE TABLE 里的列 + ADD COLUMN，再扣掉 DROP COLUMN、按 RENAME COLUMN 改名（魏征复审：
 * 只认加不认删，删了列测试照样绿、上线照样 400）。
 */
function columnsAfterReplay(files: Array<{ name: string; sql: string }>): Set<string> {
  const cols = new Set<string>()
  for (const { sql: raw } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = stripSqlComments(raw)
    if (!/ad_strategy_configs/i.test(sql)) continue

    // 建表块只截到**这张表自己**的收尾括号（行首的 `)`），不会越界吃进后面别的表
    const create = sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?ad_strategy_configs\s*\(([\s\S]*?)\n\s*\)\s*;/i)
    if (create) {
      for (const line of create[1].split('\n')) {
        const col = line.trim().match(/^([a-z_][a-z0-9_]*)\s+[A-Za-z]/)
        if (col && !/^(constraint|primary|unique|check|foreign)$/i.test(col[1])) cols.add(col[1].toLowerCase())
      }
    }

    // ALTER TABLE … ad_strategy_configs 这一条语句里的子句（可能一条语句加 / 删多列）
    for (const stmt of sql.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?ad_strategy_configs\b([\s\S]*?);/gi)) {
      const body = stmt[1]
      for (const m of body.matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)) cols.add(m[1].toLowerCase())
      for (const m of body.matchAll(/DROP COLUMN(?: IF EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)) cols.delete(m[1].toLowerCase())
      for (const m of body.matchAll(/RENAME COLUMN\s+([a-z_][a-z0-9_]*)\s+TO\s+([a-z_][a-z0-9_]*)/gi)) {
        if (cols.delete(m[1].toLowerCase())) cols.add(m[2].toLowerCase())
      }
    }
  }
  return cols
}

function migratedColumns(): Set<string> {
  return columnsAfterReplay(
    readdirSync(MIGRATIONS_DIR)
      .filter((n) => n.endsWith('.sql'))
      .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') })),
  )
}

describe('ad_strategy_configs：config.ts 读的列都有 migration 建过', () => {
  it('解析器自己没瞎：至少认出建表那几列和后来加的列', () => {
    const cols = migratedColumns()
    // 建表时的列 + 三批后加的列各挑一个，任何一个认不出就是解析器坏了，不是业务问题
    for (const c of ['client_id', 'enabled', 'digest_recipients', 'autonomy_mode', 'autopilot_dry_run']) {
      expect(cols.has(c), `解析器没认出 ${c}`).toBe(true)
    }
  })

  // 子牙复审 W116-5：删列 / 改名要有样例钉住，不能只靠真仓库里恰好没有这种 migration
  it('重放认删列和改名，而且按文件名顺序', () => {
    const cols = columnsAfterReplay([
      { name: '003_rename.sql', sql: 'ALTER TABLE public.ad_strategy_configs RENAME COLUMN old_name TO new_name;' },
      { name: '001_create.sql', sql: 'CREATE TABLE IF NOT EXISTS ad_strategy_configs (\n  client_id UUID PRIMARY KEY,\n  enabled BOOLEAN,\n  old_name TEXT\n);\nCREATE TABLE other (\n  stray_col TEXT\n);' },
      { name: '002_alter.sql', sql: 'ALTER TABLE ad_strategy_configs\n  ADD COLUMN IF NOT EXISTS added_col integer,\n  DROP COLUMN IF EXISTS enabled;\n-- ADD COLUMN in_comment text' },
    ])
    expect([...cols].sort()).toEqual(['added_col', 'client_id', 'new_name'])
  })

  it('每一列都能在 migration 里找到', () => {
    const selected = selectedColumns()
    expect(selected.length).toBeGreaterThan(0)
    const cols = migratedColumns()
    const missing = selected.filter((c) => !cols.has(c.toLowerCase()))
    expect(missing, `这些列 config.ts 在读，但没有任何 migration 建过：${missing.join(', ')}`).toEqual([])
  })
})
