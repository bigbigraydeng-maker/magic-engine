import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261110150000_conversion_payment_match_enabled.sql'),
  'utf8',
)

describe('成交自动回传开关 migration', () => {
  it('默认关，并且只把 CTS 那一行打开', () => {
    expect(SQL).toContain('add column if not exists conversion_payment_match_enabled boolean not null default false')
    expect(SQL).toContain("where id = 'c0000000-0000-0000-0000-000000000000'")
    expect(SQL).not.toMatch(/update public\.clients[\s\S]*where id <> /)
  })

  it('不新建策略、不改别的表', () => {
    expect(SQL.toLowerCase()).not.toContain('create policy')
    expect(SQL).not.toContain('me_sale_outcomes')
    expect(SQL).not.toContain('enable row level security')
  })
})
