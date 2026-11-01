// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PROVIDER_EVENT_ID_MAX, PROVIDER_MESSAGE_ID_MAX, EVENT_TYPE_MAX } from '../types'

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
    // 用正则从 $$ ... $$ 之间取出函数体，避免按 'end' 截取时误截到 append_only 里的 end
    const match = CLEAN.match(
      /create or replace function public\.provider_webhook_events_append_only\(\)[^$]*as \$\$([\s\S]*?)\$\$/,
    )
    expect(match).not.toBeNull()
    const body = (match?.[1] ?? '').trim()
    // 函数体必须与期望完全一致，任何多余语句（例如提前 return）都会让测试变红
    expect(body).toBe(
      "begin raise exception '% is append-only: % is not allowed', tg_table_name, tg_op using errcode = 'restrict_violation'; end;",
    )
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

  it('defines each column with its exact CHECK constraint', () => {
    // 逐列精确断言 CHECK 子句，期望串同样做归一化处理
    expect(CLEAN).toContain(
      normalize("provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$')"),
    )
    expect(CLEAN).toContain(
      normalize("account text not null check (account ~ '^[a-z][a-z0-9_]{1,30}$')"),
    )
    expect(CLEAN).toContain(
      normalize(
        'provider_event_id text not null check (char_length(provider_event_id) between 1 and 200)',
      ),
    )
    expect(CLEAN).toContain(
      normalize(
        'event_type text not null check (char_length(event_type) between 1 and 80)',
      ),
    )
    expect(CLEAN).toContain(
      normalize(
        'provider_message_id text check (provider_message_id is null or char_length(provider_message_id) between 1 and 200)',
      ),
    )
    expect(CLEAN).toContain(
      normalize("payload jsonb not null check (jsonb_typeof(payload) = 'object')"),
    )
  })

  it('keeps length limits in sync with shared constants', () => {
    // 从 SQL 中取出三个长度上限，与共享常量比对，防止常量漂移
    const eventIdMatch = CLEAN.match(
      /char_length\(provider_event_id\) between 1 and (\d+)/,
    )
    const messageIdMatch = CLEAN.match(
      /char_length\(provider_message_id\) between 1 and (\d+)/,
    )
    const eventTypeMatch = CLEAN.match(/char_length\(event_type\) between 1 and (\d+)/)

    expect(eventIdMatch).not.toBeNull()
    expect(messageIdMatch).not.toBeNull()
    expect(eventTypeMatch).not.toBeNull()

    expect(Number(eventIdMatch?.[1])).toBe(PROVIDER_EVENT_ID_MAX)
    expect(Number(messageIdMatch?.[1])).toBe(PROVIDER_MESSAGE_ID_MAX)
    expect(Number(eventTypeMatch?.[1])).toBe(EVENT_TYPE_MAX)
  })

  it('creates exactly one table', () => {
    const matches = CLEAN.match(/create table/g)
    expect(matches).not.toBeNull()
    expect(matches?.length).toBe(1)
  })
})
