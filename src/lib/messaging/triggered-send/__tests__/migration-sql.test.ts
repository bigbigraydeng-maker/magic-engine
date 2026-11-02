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

  it('raises every exception with restrict_violation except two named ones', () => {
    // 例外只有两处：入参无效（invalid_parameter_value）与「必须恰好更新一行」（不带 errcode）
    const raiseCount = CLEAN.match(/raise exception/g)?.length ?? 0
    const restrictCount = CLEAN.match(/errcode = 'restrict_violation'/g)?.length ?? 0
    expect(CLEAN).toContain("using errcode = 'invalid_parameter_value'")
    expect(CLEAN).toContain("raise exception 'triggered_send_claim: expected to update exactly one row'")
    expect(raiseCount - restrictCount).toBe(2)
  })

  it('only lets the claim function write live pending rows (claim marker on both guards)', () => {
    const marker = "coalesce(current_setting('app.triggered_send_claim', true), '') <> 'on'"
    expect(CLEAN.split(marker).length - 1).toBe(2)
    // 认领函数先设标记、写完立刻复位
    expect(CLEAN).toContain("perform set_config('app.triggered_send_claim', 'on', true)")
    expect(CLEAN).toContain("perform set_config('app.triggered_send_claim', '', true)")
  })

  it('requires every claim column on claimed statuses', () => {
    const start = CLEAN.indexOf('constraint triggered_sends_claimed_columns check')
    expect(start).toBeGreaterThanOrEqual(0)
    const block = CLEAN.slice(start, CLEAN.indexOf(');', start))
    for (const column of [
      'idempotency_key',
      'first_attempt_at',
      'to_address_sha256',
      'rendered_sha256',
      'template_key',
      'template_version',
      'template_sha256',
      'authorization_id',
      'local_day',
      'claimed_at',
      'lease_expires_at',
    ]) {
      expect(block).toContain(`${column} is not null`)
    }
  })

  it('claim function validates inputs and the rule before writing', () => {
    expect(CLEAN).toContain('p_lease_minutes not between 1 and 30')
    expect(CLEAN).toContain('p_to_address_sha256 is null')
    expect(CLEAN).toContain("'template_mismatch'")
    expect(CLEAN).toContain("'rule_invalid'")
    expect(CLEAN).toContain("'expired_unknown'")
    // 缺时区不回落默认
    expect(CLEAN).not.toContain("'pacific/auckland')")
  })

  it('pins authorization timestamps in the database and splits authorize from activate', () => {
    expect(CLEAN).toContain('new.authorized_at := now()')
    expect(CLEAN).toContain('new.activated_at := now()')
    expect(CLEAN).toContain('new.revoked_at := now()')
    expect(CLEAN).toContain('activation requires an already authorized row')
  })

  it('removes trigger, references and truncate privileges from service_role and grants helpers explicitly', () => {
    expect(CLEAN).toContain(
      'revoke trigger, references, truncate on public.triggered_send_authorizations, public.triggered_sends from service_role',
    )
    expect(CLEAN).toContain('grant execute on function public.triggered_send_status_rank(text) to service_role')
    expect(CLEAN).toContain('grant execute on function public.triggered_send_status_edge_ok(text, text) to service_role')
  })

  it('separates status regress from illegal transitions with a hint', () => {
    expect(CLEAN).toContain("'status_regress'")
    expect(CLEAN).toContain("'status_illegal'")
    expect(CLEAN).toContain("old.reason_code = 'not_sent_confirmed'")
  })

  it('keeps provider- and channel-neutral column names', () => {
    expect(CLEAN).toContain('to_address_sha256')
    expect(CLEAN).not.toContain('to_email_sha256')
    expect(CLEAN).toContain("provider_impact in ('none','provider_accepted','provider_unknown')")
  })

  it('closes the second-round review findings in the SQL text', () => {
    // 已撤销的提案：批准相关的任一列被写入都算批准（判据与时间钉死那一段一致，不能靠不填 authorized_at 绕过）
    expect(CLEAN).toContain(
      normalize(
        "if old.revoked_at is not null and old.authorized_at is null and (new.authorized_at is not null or new.authorized_by_email is not null or new.authorized_by_user_id is not null or new.live_from is not null or new.expires_at is not null) then raise exception 'triggered_send_authorizations: revoked proposal cannot be authorized'",
      ),
    )
    // failed + not_sent_confirmed 不释放同址：唯一索引与认领函数的同址计数用同一谓词（各出现一次）
    const keepsAddress = normalize("(status = 'failed' and reason_code = 'not_sent_confirmed')")
    expect(CLEAN.split(keepsAddress).length - 1).toBe(2)
    // failed 状态下 reason_code 只许写一次
    expect(CLEAN).toContain(
      "old.status = 'failed' and new.status = 'failed' and new.reason_code is distinct from old.reason_code",
    )
    // 接管只在「同一份授权、同一份渲染结果」时发生
    expect(CLEAN).toContain(
      'if v_row.authorization_id is distinct from p_authorization_id or v_row.rendered_sha256 is distinct from p_rendered_sha256 then',
    )
    // 规则时区必须是 IANA 名字
    expect(CLEAN).toContain('pg_catalog.pg_timezone_names')
  })

  it('declares the status value list exactly as designed', () => {
    expect(CLEAN).toContain(
      normalize(
        "status text not null check (status in ('shadow','blocked','skipped','pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','failed','bounced','complained'))",
      ),
    )
  })
})
