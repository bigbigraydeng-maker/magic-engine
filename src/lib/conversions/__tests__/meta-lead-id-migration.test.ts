/**
 * 20261004000001_conversion_meta_lead_id.sql 的静态守卫。
 *
 * 🔴 证明的是「迁移文件写了什么」，不是「数据库真的会那样做」——约束在 apply 之后
 *    才能用真库验，那一步是单独授权的运维动作，不在本 PR 里（自验见迁移文件末尾）。
 *    扫描前先去掉 SQL 注释，否则解释规则的注释本身会被当成罪证。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DIR = join(process.cwd(), 'supabase/migrations')
const VERSION = '20261004000001'
const FILE = `${VERSION}_conversion_meta_lead_id.sql`

function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
}
const SQL = strip(readFileSync(join(DIR, FILE), 'utf8'))

describe('meta_lead_id migration', () => {
  it('版本号在整个 migrations 目录里唯一', () => {
    const same = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f.slice(0, 14) === VERSION)
    expect(same).toEqual([FILE])
  })

  it('只加一列，列名/类型正确且可空', () => {
    expect(SQL).toMatch(/add column if not exists meta_lead_id text\s*;/i)
    expect(SQL).not.toMatch(/meta_lead_id text not null/i)
  })

  it('格式闸：null 或 15–17 位纯数字', () => {
    expect(SQL).toContain("meta_lead_id ~ '^[0-9]{15,17}$'")
    expect(SQL).toMatch(/meta_lead_id is null or/i)
  })

  it('🔴 redacted_is_empty 约束包含 meta_lead_id，且仍包含原有全部个人信息列', () => {
    const start = SQL.indexOf('me_sale_outcomes_redacted_is_empty\n  check')
    expect(start, '找不到 add constraint redacted_is_empty').toBeGreaterThan(-1)
    const block = SQL.slice(start)
    for (const col of [
      'customer_email',
      'customer_phone',
      'customer_first',
      'customer_last',
      'page_scoped_user_id',
      'meta_lead_id',
    ]) {
      expect(block, col).toContain(`${col} is null`)
    }
  })

  it('两条约束都先 NOT VALID 再 VALIDATE（不长时间持强锁）', () => {
    expect(SQL).toMatch(/me_sale_outcomes_meta_lead_id_format[\s\S]*?not valid;/i)
    expect(SQL).toMatch(/validate constraint me_sale_outcomes_meta_lead_id_format/i)
    expect(SQL).toMatch(/me_sale_outcomes_redacted_is_empty\s+check[\s\S]*?not valid;/i)
    expect(SQL).toMatch(/validate constraint me_sale_outcomes_redacted_is_empty/i)
  })

  it('不删数据、不往生产表里插行（自验只读）', () => {
    expect(SQL).not.toMatch(/\bdelete\s+from\b/i)
    expect(SQL).not.toMatch(/\binsert\s+into\b/i)
    expect(SQL).not.toMatch(/\bupdate\s+public\./i)
    expect(SQL).not.toMatch(/\bdrop\s+(table|column)\b/i)
  })
})
