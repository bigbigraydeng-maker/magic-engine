/**
 * 20261004000002_conversion_purchase_dedupe.sql 的静态守卫。
 * 证明的是「迁移文件写了什么」，不是「数据库真的会那样做」——apply 是单独授权的运维动作。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DIR = join(process.cwd(), 'supabase/migrations')
const VERSION = '20261004000002'
const FILE = `${VERSION}_conversion_purchase_dedupe.sql`

function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
}
const SQL = strip(readFileSync(join(DIR, FILE), 'utf8'))

describe('purchase dedupe migration', () => {
  it('版本号唯一', () => {
    const same = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f.slice(0, 14) === VERSION)
    expect(same).toEqual([FILE])
  })

  it('两条都是部分唯一索引，只管 purchase，被拒绝/已删除的不占位', () => {
    for (const name of ['uq_me_sale_outcomes_purchase_per_lead', 'uq_me_sale_outcomes_purchase_per_email_order']) {
      const m = new RegExp(`create unique index if not exists ${name}[\\s\\S]*?;`, 'i').exec(SQL)
      expect(m, name).not.toBeNull()
      const block = m![0]
      expect(block).toMatch(/outcome_kind = 'purchase'/)
      expect(block).toMatch(/review_status <> 'rejected'/)
      expect(block).toMatch(/redacted_at is null/)
    }
  })

  it('线索编号索引按 client + meta_lead_id；邮箱索引不分大小写且带单号', () => {
    expect(SQL).toMatch(/\(client_id, meta_lead_id\)/)
    expect(SQL).toMatch(/\(client_id, lower\(customer_email\), order_ref\)/)
  })

  it('不删数据、不插行、不改行', () => {
    expect(SQL).not.toMatch(/\bdelete\s+from\b/i)
    expect(SQL).not.toMatch(/\binsert\s+into\b/i)
    expect(SQL).not.toMatch(/\bupdate\s+public\./i)
    expect(SQL).not.toMatch(/\bdrop\s+/i)
  })
})
