// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 读取迁移 SQL 原文
const SQL = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261102130000_triggered_send_ledger.sql'),
  'utf8',
)

// 去掉每行 `--` 起始的注释（含行尾注释），统一小写并把连续空白压成单个空格
function stripComments(sql: string): string {
  const withoutComments = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
  return withoutComments.toLowerCase().replace(/\s+/g, ' ').trim()
}

// 对期望串做同样的小写与空白归一化，便于比较
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

// 去掉注释后的 SQL 文本，所有断言都基于它
const CLEAN = stripComments(SQL)

describe('triggered_send ledger migration structure', () => {
  it('creates both tables and exactly two tables', () => {
    expect(CLEAN).toContain('create table public.triggered_send_authorizations')
    expect(CLEAN).toContain('create table public.triggered_sends')
    const matches = CLEAN.match(/create table/g)
    expect(matches).not.toBeNull()
    expect(matches?.length).toBe(2)
  })

  it('enables row level security on both tables', () => {
    expect(CLEAN).toContain(
      'alter table public.triggered_send_authorizations enable row level security',
    )
    expect(CLEAN).toContain(
      'alter table public.triggered_sends enable row level security',
    )
  })

  it('scopes every create policy to service_role only', () => {
    // 按 'create policy' 切开，除第一段外每段（到分号为止）都必须带 to service_role
    const segments = CLEAN.split('create policy')
    const policySegments = segments.slice(1)
    expect(policySegments.length).toBeGreaterThanOrEqual(2)
    for (const segment of policySegments) {
      const semicolonIdx = segment.indexOf(';')
      const body = semicolonIdx === -1 ? segment : segment.slice(0, semicolonIdx)
      expect(body).toContain(' to service_role ')
    }
    // 不允许把策略开放给 public / anon / authenticated
    expect(CLEAN).not.toMatch(/\bto (public|anon|authenticated)\b/)
  })

  it('revokes anonymous and authenticated table privileges on both tables', () => {
    expect(CLEAN).toContain(
      'revoke all on public.triggered_send_authorizations from anon, authenticated',
    )
    expect(CLEAN).toContain(
      'revoke all on public.triggered_sends from anon, authenticated',
    )
  })

  it('defines the claim function with the expected shape', () => {
    expect(CLEAN).toContain('create or replace function public.triggered_send_claim(')
    expect(CLEAN).toContain('security invoker')
    expect(CLEAN).toContain('set search_path = public')
    expect(CLEAN).toContain('#variable_conflict use_column')
    expect(CLEAN).toContain('pg_advisory_xact_lock(hashtextextended(')
    expect(CLEAN).toContain('for share')
    expect(CLEAN).toContain("current_setting('transaction_isolation')")
    expect(CLEAN).toContain("'read committed'")
  })

  it('restricts claim function execute privileges to service_role', () => {
    expect(CLEAN).toContain(
      'revoke execute on function public.triggered_send_claim(uuid, uuid, text, text, text, integer, text, text, text, text, integer) from public, anon, authenticated',
    )
    expect(CLEAN).toContain(
      'grant execute on function public.triggered_send_claim(uuid, uuid, text, text, text, integer, text, text, text, text, integer) to service_role',
    )
  })

  it('does not rely on FOUND inside the claim function', () => {
    // 取认领函数体（从定义到 revoke execute 之间），FOUND 会被后面的 count 覆盖
    const start = CLEAN.indexOf('create or replace function public.triggered_send_claim(')
    const end = CLEAN.indexOf('revoke execute on function public.triggered_send_claim(')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const body = CLEAN.slice(start, end)
    expect(/\bfound\b/.test(body)).toBe(false)
  })

  it('enforces the 20 hour expiry rule in the claim function', () => {
    expect(CLEAN).toContain("interval '20 hours'")
  })

  it('avoids forbidden constructs', () => {
    expect(CLEAN).not.toContain('security definer')
    expect(CLEAN).not.toContain('notify pgrst')
    expect(CLEAN).not.toContain('on delete cascade')
    expect(CLEAN).not.toContain('create extension')
    expect(CLEAN).not.toContain('create role')
  })

  it('installs all eight triggers', () => {
    const triggerNames = [
      'triggered_send_authorizations_insert_guard',
      'triggered_send_authorizations_update_guard',
      'triggered_send_authorizations_no_delete',
      'triggered_send_authorizations_no_truncate',
      'triggered_sends_insert_guard',
      'triggered_sends_update_guard',
      'triggered_sends_no_delete',
      'triggered_sends_no_truncate',
    ]
    for (const name of triggerNames) {
      expect(CLEAN).toContain('create trigger ' + name)
    }
  })

  it('revokes execute on helper and trigger functions', () => {
    // 授权表 3 个触发器函数 + 账本 5 个函数（含 2 个状态辅助）+ 认领函数 = 9 条
    const matches = CLEAN.match(/from public, anon, authenticated;/g)
    expect(matches).not.toBeNull()
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(9)
  })

  it('lists all lifecycle columns in both sides of the update guard whitelist', () => {
    const lifecycleColumns = [
      'authorized_by_email',
      'authorized_by_user_id',
      'authorized_at',
      'live_from',
      'expires_at',
      'activated_at',
      'revoked_at',
      'revoked_by',
      'revoked_reason',
    ]
    // new 与 old 两边各有一份白名单；每个列名必须带引号完整出现（避免 'revoked_reasonx' 这种拼写变体蒙混过关）
    for (const side of ['new', 'old']) {
      const marker = `to_jsonb(${side}) - array[`
      const start = CLEAN.indexOf(marker)
      expect(start).toBeGreaterThanOrEqual(0)
      const end = CLEAN.indexOf(']', start)
      expect(end).toBeGreaterThan(start)
      const whitelist = CLEAN.slice(start, end)
      for (const column of lifecycleColumns) {
        expect(whitelist).toContain(`'${column}'`)
      }
      // 恰好 9 个列名，不多不少
      expect((whitelist.match(/'/g) ?? []).length).toBe(lifecycleColumns.length * 2)
    }
  })

  it('declares the two partial unique indexes on the authorization table', () => {
    expect(CLEAN).toContain(
      normalize(
        'create unique index triggered_send_authorizations_one_active on public.triggered_send_authorizations (client_id, trigger_key, channel) where authorized_at is not null and revoked_at is null',
      ),
    )
    expect(CLEAN).toContain(
      normalize(
        'create unique index triggered_send_authorizations_one_proposal on public.triggered_send_authorizations (client_id, trigger_key, channel) where authorized_at is null and revoked_at is null',
      ),
    )
  })

  it('declares the three unique indexes on the ledger table', () => {
    expect(CLEAN).toContain('create unique index triggered_sends_idempotency_key_idx')
    expect(CLEAN).toContain('create unique index triggered_sends_provider_message_idx')
    expect(CLEAN).toContain('create unique index triggered_sends_lifetime_address_idx')
  })

  it('maps status ranks exactly as designed', () => {
    // 从状态等级函数体里取出所有 (状态, 数字) 映射
    const start = CLEAN.indexOf('create or replace function public.triggered_send_status_rank(')
    expect(start).toBeGreaterThanOrEqual(0)
    const body = CLEAN.slice(start)
    const rankMap: Record<string, number> = {}
    const re = /when '([a-z_]+)' then (\d+)/g
    let match: RegExpExecArray | null = re.exec(body)
    while (match !== null) {
      rankMap[match[1]] = Number(match[2])
      match = re.exec(body)
    }
    expect(rankMap).toEqual({
      pending: 1,
      unknown_outcome: 2,
      sent: 3,
      delivery_delayed: 4,
      delivered: 5,
      suppressed: 6,
      failed: 6,
      bounced: 7,
      complained: 8,
    })
  })

  it('keeps the key numeric limits', () => {
    expect(CLEAN).toContain('daily_cap integer not null check (daily_cap between 1 and 50)')
    expect(CLEAN).toContain("interval '90 days'")
    expect(CLEAN).toContain("interval '36 hours'")
  })

  it('raises every exception with restrict_violation except the row-count guard', () => {
    // 只有 'expected to update exactly one row' 这一处不带 errcode
    const raiseMatches = CLEAN.match(/raise exception/g)
    const errcodeMatches = CLEAN.match(/errcode = 'restrict_violation'/g)
    const raiseCount = raiseMatches?.length ?? 0
    const errcodeCount = errcodeMatches?.length ?? 0
    expect(raiseCount - errcodeCount).toBe(1)
  })

  it('declares the status value list exactly as designed', () => {
    expect(CLEAN).toContain(
      normalize(
        "status text not null check (status in ('shadow','blocked','skipped','pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','failed','bounced','complained'))",
      ),
    )
  })
})
