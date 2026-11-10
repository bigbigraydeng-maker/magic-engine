/**
 * 20261110000001 线索阶段迁移的静态守卫。
 *
 * 🔴 这些断言证明的是「迁移文件写了什么」，不是「数据库真的会那样做」——
 *    后者靠迁移末尾的自验块，在执行迁移时由真库验证。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DIR = join(process.cwd(), 'supabase/migrations')
const VERSION = '20261110000001'
const FILE = `${VERSION}_conversion_lead_stage.sql`
const SQL = readFileSync(join(DIR, FILE), 'utf8')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n')

describe('线索阶段迁移', () => {
  it('版本号在 migrations 目录里唯一', () => {
    expect(readdirSync(DIR).filter((f) => f.endsWith('.sql') && f.startsWith(VERSION))).toEqual([FILE])
  })

  it('种类约束保留原有三种并新增 lead_stage', () => {
    expect(SQL).toMatch(/outcome_kind in \('purchase', 'balance', 'lead', 'lead_stage'\)/)
  })

  it('来源约束保留原有全部取值并新增 crm_stage_auto', () => {
    for (const v of [
      'manual_seed', 'inbox_extract', 'web_form', 'meta_lead_form', 'api',
      'crm_hubspot', 'crm_sheet_sync', 'messenger_conversation', 'crm_stage_manual', 'crm_stage_auto',
    ]) {
      expect(SQL).toContain(`'${v}'`)
    }
  })

  it('金额规则只放宽到 lead_stage，成交/尾款仍必须带金额', () => {
    expect(SQL).toMatch(/outcome_kind in \('lead', 'lead_stage'\)\s*or \(amount_minor is not null and currency is not null\)/)
  })

  it('lead_stage 必须带阶段名与线索编号（脱敏后的除外）', () => {
    expect(SQL).toContain("(outcome_kind = 'lead_stage') = (lead_stage is not null)")
    expect(SQL).toMatch(/outcome_kind <> 'lead_stage'\s*or redacted_at is not null\s*or meta_lead_id is not null/)
  })

  it('同一位客人的同一档只能有一条（换了线索编号也不行）', () => {
    expect(SQL).toMatch(/create unique index if not exists uq_me_sale_outcomes_lead_stage_per_contact\s+on public\.me_sale_outcomes \(client_id, contact_id, lead_stage\)\s+where outcome_kind = 'lead_stage' and contact_id is not null/)
  })

  it('不碰权限策略、不删表不删列', () => {
    expect(SQL).not.toMatch(/\bpolicy\b/i)
    expect(SQL).not.toMatch(/drop\s+(table|column)/i)
  })

  it('带自验块，且自验里的测试行会被删掉', () => {
    expect(SQL).toContain('do $$')
    expect(SQL).toContain("delete from public.me_sale_outcomes where source_ref = 'self_check_lead_stage'")
  })
})
