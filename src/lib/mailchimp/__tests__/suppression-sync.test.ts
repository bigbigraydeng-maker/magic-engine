/**
 * CRM「不感兴趣 / 别再联系」→ Mailchimp 抑制标签同步。
 *
 * 钉住的是：判据必须跟 `crm/dnc.ts` / `crm/segments.ts` 的既有口径完全一致
 * （不是重新发明一份），并且只加标签、绝不摘。
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  needsSuppression,
  syncSuppressionTags,
  DEFAULT_SUPPRESS_TAG,
  type ContactForSuppressionCheck,
} from '../suppression-sync'

const CFG_BASE = { apiKey: 'key-us19', audienceId: 'dda97b7e61' }

/** 假 Mailchimp：按「名单里有谁、他有什么标签」建模。 */
function fakeMailchimp(audience: Record<string, string[]>) {
  const writes: Array<{ email: string; tags: unknown }> = []
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const hashToEmail = new Map(
      Object.keys(audience).map((e) => [createHash('md5').update(e.toLowerCase()).digest('hex'), e]),
    )
    const hash = url.split('/members/')[1]?.split(/[/?]/)[0] ?? ''
    const email = hashToEmail.get(hash)

    if (url.includes('/tags')) {
      writes.push({ email: email ?? '?', tags: JSON.parse(String(init?.body)).tags })
      return new Response(null, { status: 204 })
    }
    if (!email) return new Response(JSON.stringify({ title: 'Not Found' }), { status: 404 })
    return new Response(
      JSON.stringify({ email_address: email, status: 'subscribed', tags: audience[email].map((name) => ({ name })) }),
      { status: 200 },
    )
  }
  return { cfg: { ...CFG_BASE, fetchImpl: impl }, writes }
}

function contact(over: Partial<ContactForSuppressionCheck>): ContactForSuppressionCheck {
  return {
    contactId: 'c1',
    email: 'jane@example.com',
    doNotContactFlag: false,
    touches: [],
    ...over,
  }
}

describe('needsSuppression · 判据必须跟 crm/dnc.ts 一致', () => {
  it('contacts.do_not_contact 那一列是 true → 该抑制', () => {
    expect(needsSuppression(contact({ doNotContactFlag: true }))).toBe(true)
  })

  it('触点里出现过 do_not_contact → 该抑制', () => {
    expect(needsSuppression(contact({ touches: [{ outcome: 'do_not_contact', occurredAt: '2026-07-16T00:00:00Z' }] }))).toBe(true)
  })

  it('触点里出现过 not_interested → 该抑制（没有纠正机制，出现一次就算数）', () => {
    expect(needsSuppression(contact({ touches: [{ outcome: 'not_interested', occurredAt: '2026-07-16T00:00:00Z' }] }))).toBe(true)
  })

  it('人明确纠正过 do_not_contact（dnc_cleared 晚于那条判词）→ 不该抑制', () => {
    const c = contact({
      touches: [
        { outcome: 'do_not_contact', occurredAt: '2026-07-16T00:00:00Z' },
        { outcome: 'dnc_cleared', occurredAt: '2026-07-20T00:00:00Z' },
      ],
    })
    expect(needsSuppression(c)).toBe(false)
  })

  it('普通正常联系人 → 不该抑制', () => {
    expect(needsSuppression(contact({ touches: [{ outcome: 'contacted', occurredAt: '2026-07-16T00:00:00Z' }] }))).toBe(false)
  })
})

describe('syncSuppressionTags · 只加标签', () => {
  it('该抑制的人，Mailchimp 里还没打标签 → 补上', async () => {
    const { cfg, writes } = fakeMailchimp({ 'jane@example.com': ['reborn_leadform'] })
    const r = await syncSuppressionTags(
      [contact({ contactId: 'c1', email: 'jane@example.com', doNotContactFlag: true })],
      cfg,
    )
    expect(r.newlySuppressed).toEqual(['c1'])
    expect(writes).toEqual([{ email: 'jane@example.com', tags: [{ name: DEFAULT_SUPPRESS_TAG, status: 'active' }] }])
  })

  it('该抑制的人，Mailchimp 里已经打过标签 → noop，不重复写', async () => {
    const { cfg, writes } = fakeMailchimp({ 'jane@example.com': [DEFAULT_SUPPRESS_TAG] })
    const r = await syncSuppressionTags(
      [contact({ contactId: 'c1', email: 'jane@example.com', doNotContactFlag: true })],
      cfg,
    )
    expect(r.alreadyTagged).toBe(1)
    expect(r.newlySuppressed).toEqual([])
    expect(writes).toEqual([])
  })

  it('不该抑制的人 → 完全跳过，不查也不写', async () => {
    const { cfg, writes } = fakeMailchimp({ 'jane@example.com': ['reborn_leadform'] })
    const r = await syncSuppressionTags(
      [contact({ contactId: 'c1', email: 'jane@example.com', doNotContactFlag: false, touches: [] })],
      cfg,
    )
    expect(r.newlySuppressed).toEqual([])
    expect(r.alreadyTagged).toBe(0)
    expect(writes).toEqual([])
  })

  it('该抑制但没有邮箱 → 计入 skippedNoEmail，不报错', async () => {
    const { cfg } = fakeMailchimp({})
    const r = await syncSuppressionTags([contact({ email: null, doNotContactFlag: true })], cfg)
    expect(r.skippedNoEmail).toBe(1)
  })

  it('该抑制但邮箱压根不在这个 audience 里 → 计入 notInAudience，不报错', async () => {
    const { cfg } = fakeMailchimp({})
    const r = await syncSuppressionTags(
      [contact({ email: 'not-subscribed@example.com', doNotContactFlag: true })],
      cfg,
    )
    expect(r.notInAudience).toBe(1)
    expect(r.errors).toEqual([])
  })

  it('标签名可以按客户配置覆盖，不写死 suppressed_do_not_email', async () => {
    const { cfg, writes } = fakeMailchimp({ 'jane@example.com': [] })
    await syncSuppressionTags(
      [contact({ email: 'jane@example.com', doNotContactFlag: true })],
      cfg,
      { suppressTag: 'do_not_email_custom' },
    )
    expect(writes).toEqual([{ email: 'jane@example.com', tags: [{ name: 'do_not_email_custom', status: 'active' }] }])
  })
})
