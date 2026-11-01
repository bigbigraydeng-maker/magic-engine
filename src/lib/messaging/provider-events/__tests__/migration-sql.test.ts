// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 读取迁移 SQL 原文
const SQL = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261101150000_provider_webhook_events.sql'),
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

describe('provider_webhook_events migration structure', () => {
  it('creates the provider_webhook_events table', () => {
    expect(CLEAN).toContain('create table public.provider_webhook_events')
  })

  it('declares the unique constraint on provider, account and provider_event_id', () => {
    expect(CLEAN).toContain(
      'constraint provider_webhook_events_event_key unique (provider, account, provider_event_id)',
    )
  })

  it('enables row level security on the table', () => {
    expect(CLEAN).toContain(
      'alter table public.provider_webhook_events enable row level security',
    )
  })

  it('scopes every create policy to service_role only', () => {
    // 按 'create policy' 切开，除第一段外每段（到分号为止）都必须带 to service_role
    const segments = CLEAN.split('create policy')
    const policySegments = segments.slice(1)
    expect(policySegments.length).toBeGreaterThan(0)
    for (const segment of policySegments) {
      const semicolonIdx = segment.indexOf(';')
      const body = semicolonIdx === -1 ? segment : segment.slice(0, semicolonIdx)
      expect(body).toContain(' to service_role ')
    }
    // 不允许把策略开放给 public / anon / authenticated
    expect(CLEAN).not.toContain('to public')
    expect(CLEAN).not.toContain('to anon')
    expect(CLEAN).not.toContain('to authenticated')
  })

  it('revokes anonymous and authenticated table privileges', () => {
    expect(CLEAN).toContain(
      'revoke all on public.provider_webhook_events from anon, authenticated',
    )
  })

  it('revokes execute on the trigger function from public, anon and authenticated', () => {
    expect(CLEAN).toContain(
      'revoke all on function public.provider_webhook_events_append_only() from public, anon, authenticated',
    )
  })

  it('installs append-only triggers for update, delete and truncate', () => {
    expect(CLEAN).toContain(
      'before update or delete on public.provider_webhook_events for each row',
    )
    expect(CLEAN).toContain(
      'before truncate on public.provider_webhook_events for each statement',
    )
    // 两个触发器都调用同一个 append-only 函数
    const executeMatches = CLEAN.match(
      /execute function public\.provider_webhook_events_append_only\(\)/g,
    )
    expect(executeMatches).not.toBeNull()
    expect(executeMatches?.length).toBe(2)
  })

  it('makes the trigger function raise unconditionally', () => {
    expect(CLEAN).toContain("errcode = 'restrict_violation'")
    // 提取 begin ... end 之间的函数体，确认没有 if 条件分支
    const beginIdx = CLEAN.indexOf('begin')
    const endIdx = CLEAN.lastIndexOf('end')
    expect(beginIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(beginIdx)
    const body = CLEAN.slice(beginIdx + 'begin'.length, endIdx)
    expect(body).not.toContain('if ')
  })

  it('avoids forbidden constructs', () => {
    expect(CLEAN).not.toContain('notify pgrst')
    expect(CLEAN).not.toContain('create index')
    expect(CLEAN).not.toContain('references')
    expect(CLEAN).not.toContain('client_id')
    expect(CLEAN).not.toContain('on delete cascade')
    expect(CLEAN).not.toContain('create role')
    expect(CLEAN).not.toContain('security definer')
  })

  it('defines columns with the expected CHECK constraints', () => {
    expect(CLEAN).toContain(normalize("check (provider ~ '^[a-z][a-z0-9_]{1,30}$')"))
    expect(CLEAN).toContain(normalize("check (account ~ '^[a-z][a-z0-9_]{1,30}$')"))
    expect(CLEAN).toContain(
      normalize("payload jsonb not null check (jsonb_typeof(payload) = 'object')"),
    )
    expect(CLEAN).toContain(
      normalize(
        'provider_event_id text not null check (char_length(provider_event_id) between 1 and 200)',
      ),
    )
  })

  it('creates exactly one table', () => {
    const matches = CLEAN.match(/create table/g)
    expect(matches).not.toBeNull()
    expect(matches?.length).toBe(1)
  })
})
