/**
 * AD-SEC-4 — a paused Messenger / lead sync must reach「需要你动手」, not only a
 * cron summary line (铁律 3 下半). Uses the real gate against the fake DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBindingFakeDb, asSupabaseClient, type FakeDb, type FakeFailures } from '@/lib/meta/__tests__/binding-fake-db'

vi.mock('@/lib/platform-oauth/vocabulary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform-oauth/vocabulary')>()),
  decryptToken: (e: string) => e,
}))

import { pushPageBindingItems } from '../page-binding-items'
import { assertAbsoluteHref, type ManualItem } from '../manual-items'

const PAGE = '1616575215312482'
let db: FakeDb
let failures: FakeFailures

const client = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Client ${id}`, domain: null, facebook_page_id: PAGE, created_at: '2026-01-01T00:00:00Z', source: 'fde', ...over,
})

async function run(env: Record<string, string | undefined>) {
  const items: ManualItem[] = []
  await pushPageBindingItems(asSupabaseClient(makeBindingFakeDb(db, failures)), items, env)
  return items
}

beforeEach(() => {
  db = { clients: [], client_binding_audit: [], platform_oauth_connections: [] }
  failures = {}
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('pushPageBindingItems', () => {
  it('paused (unverified, shared token only) → an item that says the inbox and leads are paused, with an absolute link to the panel', async () => {
    db.clients.push(client('a'))
    const items = await run({ META_SYSTEM_USER_TOKEN: 'shared' })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'facebook_page_binding_unverified', client_id: 'a', client_name: 'Client a' })
    expect(items[0].what).toContain('已暂停')
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/a?settings=platform')
    expect(() => assertAbsoluteHref(items[0])).not.toThrow()
  })

  it('bound to two clients → both get an item that says to work out whose Page it is first', async () => {
    db.clients.push(client('a'), client('b'))
    const items = await run({ META_SYSTEM_USER_TOKEN: 'shared' })
    expect(items.map((i) => i.client_id).sort()).toEqual(['a', 'b'])
    expect(items[0].how).toContain('到底是哪个客户的')
  })

  it('still running on a legacy per-client token → a lower-urgency "verify once" item', async () => {
    db.clients.push(client('a', { domain: 'a.example.com' }))
    const items = await run({ META_SYSTEM_USER_TOKEN_A_EXAMPLE_COM: 'a-token' })
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('还在同步')
  })

  it('verified (staff audit or OAuth) and unbound clients → nothing', async () => {
    db.clients.push(client('a'), client('b'), client('c', { facebook_page_id: null }))
    db.clients[1].facebook_page_id = '2222222222222'
    db.client_binding_audit.push({ client_id: 'a', binding_kind: 'facebook_page', action: 'bind', outcome: 'applied', requested_value: PAGE, created_at: '2026-09-17T00:00:00Z' })
    db.platform_oauth_connections.push({ client_id: 'b', provider: 'meta', account_id: '2222222222222', status: 'active', access_token_enc: 'tok' })
    expect(await run({ META_SYSTEM_USER_TOKEN: 'shared' })).toEqual([])
  })

  it('column carries stray spaces the audit does not → the sync refuses, so the todo must too', async () => {
    db.clients.push(client('a', { facebook_page_id: ` ${PAGE} ` }))
    db.client_binding_audit.push({ client_id: 'a', binding_kind: 'facebook_page', action: 'bind', outcome: 'applied', requested_value: PAGE, created_at: '2026-09-17T00:00:00Z' })
    const items = await run({ META_SYSTEM_USER_TOKEN: 'shared' })
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('已暂停')
  })

  it('comment auto-reply configured on a Page that is not the client\'s → "auto-reply stopped" item; configured on the bound Page → no duplicate', async () => {
    db.clients.push(client('a'), client('b', { facebook_page_id: '2222222222222' }))
    db.client_binding_audit.push(
      { client_id: 'a', binding_kind: 'facebook_page', action: 'bind', outcome: 'applied', requested_value: PAGE, created_at: '2026-09-17T00:00:00Z' },
      { client_id: 'b', binding_kind: 'facebook_page', action: 'bind', outcome: 'applied', requested_value: '2222222222222', created_at: '2026-09-17T00:00:00Z' },
    )
    db.social_comment_config = [
      { client_id: 'a', enabled: true, fb_page_id: '9999999999999' },
      { client_id: 'b', enabled: true, fb_page_id: ' 2222222222222' },
    ]
    const items = await run({ META_SYSTEM_USER_TOKEN: 'shared' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ client_id: 'a' })
    expect(items[0].what).toContain('评论自动回复已停')
  })

  /**
   * 🔴 2026-09-27：这一档原来教人先点「重新核实」——**那条修法治不了私信**。
   *
   * 「重新核实」只补一条核实记录，让同步改用**公用令牌**去读；而公用令牌那个账号在
   * 客户主页上的角色是「看数据 / 投广告 / 发内容」，没有「消息」。生产实测（2026-09-27
   * 06:10 那次同步）：Roman HU 和 East International 已经过了这道闸，私信照样 403
   * `Requires permission: pages_messaging`；而同一把令牌**读表单线索是好的**。
   *
   * 所以照旧文案点下去 = 卡片变绿、表单恢复、私信一条不进。两条都钉住：
   * 该档必须先说「连接 Meta」，别的档不许被这句话污染。
   */
  it('shared-token-only → the fix must lead with 「连接 Meta」 and warn that 「重新核实」 alone leaves the inbox dead', async () => {
    db.clients.push(client('a'))
    const how = (await run({ META_SYSTEM_USER_TOKEN: 'shared' }))[0].how

    expect(how).toContain('连接 Meta')
    expect(how).toContain('『消息』权限')
    // 先说对的那个 —— 顺序就是这条修正的全部内容
    expect(how.indexOf('连接 Meta')).toBeLessThan(how.indexOf('重新核实'))
    // 而且必须明说另一个按钮只修一半，否则看到卡片变绿的人会以为好了
    expect(how).toContain('私信仍然一条都进不来')
  })

  it('a different refusal (audit mismatch) keeps the re-save wording — the new text must not leak across reasons', async () => {
    db.clients.push(client('a'))
    db.client_binding_audit.push({ client_id: 'a', binding_kind: 'facebook_page', action: 'bind', outcome: 'applied', requested_value: '9999999999999', created_at: '2026-09-17T00:00:00Z' })
    const how = (await run({ META_SYSTEM_USER_TOKEN: 'shared' }))[0].how

    expect(how).toContain('重新核实')
    expect(how).not.toContain('私信仍然一条都进不来')
  })

  it('cannot read the client list → one item saying the check did not run (not just a log line)', async () => {
    failures = { select: new Set(['clients']) }
    const items = await run({ META_SYSTEM_USER_TOKEN: 'shared' })
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('没查成')
    expect(() => assertAbsoluteHref(items[0])).not.toThrow()
  })
})
