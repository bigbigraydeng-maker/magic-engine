/**
 * 邮件 → 标签 的编排层。
 *
 * 这里钉的是「什么时候**不做**」：催款的不碰、同事的不碰、编出来的证据不认、
 * 名单里没有的不建。做对一件事只让一个客人少收一封邮件；做错一件事会把一个
 * 正在谈的客人停掉全部跟进。
 */

import { describe, expect, it, vi } from 'vitest'
import { runPaidTagging, DEFAULT_PAID_TAG, type CandidateMail } from '../paid-tagging'
import * as signal from '../paid-signal'

const POLICY = {
  paidTag: DEFAULT_PAID_TAG,
  leadTagsToRemove: ['fb_lead', 'reborn_leadform'],
  ownDomains: ['ctstours.co.nz', 'chinatravel.co.nz'],
}
const CFG_BASE = { apiKey: 'key-us19', audienceId: 'dda97b7e61' }

/** 假 Mailchimp：按「名单里有谁、他有什么标签」建模，不按调用次序。 */
function fakeMailchimp(audience: Record<string, string[]>) {
  const writes: Array<{ email: string; tags: unknown }> = []
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const hashToEmail = new Map(
      Object.keys(audience).map((e) => [require('node:crypto').createHash('md5').update(e).digest('hex'), e]),
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

function mail(over: Partial<CandidateMail>): CandidateMail {
  return {
    id: 'm1',
    subject: null,
    preview: '',
    receivedAt: '2026-09-01T11:02:00Z',
    direction: 'outbound',
    counterparty: { address: 'enrkay@gmail.com', name: 'Nikki Smith' },
    ...over,
  }
}

describe('runPaidTagging · 自动打标签', () => {
  it('真实语料：Baker 确认收款 → 打上 paid_customer 并摘掉线索标签', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead', 'reborn_leadform'] })
    const r = await runPaidTagging(
      [mail({ subject: 'Best of China - November', preview: 'Hi Nikki Your payment has been received in full. Thank you so much.' })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(1)
    expect(r.tagged[0].added).toEqual(['paid_customer'])
    expect(r.tagged[0].removed).toEqual(['fb_lead', 'reborn_leadform'])
    expect(writes).toHaveLength(1)
  })

  it('同一个人两封确认信（定金+尾款）→ 只写一次', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead'] })
    const r = await runPaidTagging(
      [
        mail({ id: 'a', preview: 'Your deposit has been received' }),
        mail({ id: 'b', preview: 'Your payment has been received in full' }),
      ],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(1)
    expect(writes).toHaveLength(1)
  })
})

describe('runPaidTagging · 🔴 什么时候不做', () => {
  it('🔴 催款邮件 → 进 chasing，绝不打标签', async () => {
    const { cfg, writes } = fakeMailchimp({ 'lorraine@example.com': ['fb_lead'] })
    const r = await runPaidTagging(
      [mail({
        subject: 'Payment of Invoice - Best of China Tour',
        preview: 'Dear Lorraine, Please find the credit card payment link below: https://gateway-app.latipay.net/payment-me',
        counterparty: { address: 'lorraine@example.com', name: 'Lorraine' },
      })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(r.chasing).toEqual(['lorraine@example.com'])
    expect(writes).toHaveLength(0)
  })

  it('🔴 收件人是自己人 → 完全跳过，不打标签也不报数', async () => {
    const { cfg, writes } = fakeMailchimp({ 'bdm@ctstours.co.nz': [] })
    const r = await runPaidTagging(
      [mail({ preview: 'Your payment has been received', counterparty: { address: 'bdm@ctstours.co.nz', name: 'BDM' } })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  it('🔴 命中确认句但人不在 Mailchimp 名单里 → 记 notInAudience，绝不新建', async () => {
    const { cfg, writes } = fakeMailchimp({})
    const r = await runPaidTagging([mail({ preview: 'Your payment has been received in full' })], cfg, POLICY)
    expect(r.tagged).toHaveLength(0)
    expect(r.notInAudience).toEqual(['enrkay@gmail.com'])
    expect(writes).toHaveLength(0)
  })

  it('🔴 客人自己说付了 → needs_review，不自动打', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead'] })
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', subject: 'Payment confirmation', preview: 'Get Outlook for Android' })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(r.needsReview).toHaveLength(1)
    expect(r.needsReview[0].email).toBe('enrkay@gmail.com')
    expect(writes).toHaveLength(0)
  })

  it('🔴 关联公司的同事（pa@chinatravel.co.nz）→ 跳过，不打标签', async () => {
    const { cfg, writes } = fakeMailchimp({ 'pa@chinatravel.co.nz': ['fb_lead'] })
    const r = await runPaidTagging(
      [mail({ preview: 'Your payment has been received', counterparty: { address: 'pa@chinatravel.co.nz', name: 'PA' } })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  it('普通询价邮件 → 什么都不做', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': [] })
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', preview: 'Can you please forward me the full itinerary' })],
      cfg,
      POLICY,
    )
    expect(r.scanned).toBe(1)
    expect(r.tagged).toHaveLength(0)
    expect(r.needsReview).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })
})

describe('runPaidTagging · 🔴 铁律 8：说不出原话就不算数', () => {
  /**
   * 魏征复审发现的真空洞：`evidenceIsVerbatim` 那道闸此前**只有函数自身的单测**，
   * 编排层从没有一条行为测试 —— 把 `runPaidTagging` 里那句 if 删掉，8 个测试
   * 全绿。也就是说这道防编造的闸随时可能被删掉而没人发现。
   *
   * 这里用一段「判据能匹配、但证据无法在原文里逐字找回」的输入把它钉住。
   * evidence 是从 `text` 上截的，正常路径下必然逐字命中；要让它对不上，就得
   * 让判定看到的文本和核对用的文本不是同一份 —— 这正是那道闸要防的漂移。
   */
  it('🔴 evidence 在原文里对不上 → 整条丢掉，绝不打标签', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead'] })
    const spy = vi.spyOn(signal, 'evidenceIsVerbatim').mockReturnValue(false)
    try {
      const r = await runPaidTagging(
        [mail({ preview: 'Hi Nikki Your payment has been received in full.' })],
        cfg,
        POLICY,
      )
      expect(r.tagged).toHaveLength(0)
      expect(writes).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('evidence 对得上 → 正常打（证明上一条不是因为别的原因空的）', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead'] })
    const r = await runPaidTagging(
      [mail({ preview: 'Hi Nikki Your payment has been received in full.' })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(1)
    expect(writes).toHaveLength(1)
  })
})

describe('runPaidTagging · 🔴 处理过的人不再问', () => {
  /**
   * 2026-09-06 生产实测：待确认名单上 4 个人**全部**已经有 paid_customer 了。
   * Baker 每天打开待办看到的是同一批已处理的名字 —— 处理完也不消失，
   * 这种待办栏人很快就不看了，铁律 3 下半的人工车道等于白建。
   */
  it('🔴 客人说付了，但他已经有 paid_customer → 不再进待办', async () => {
    const { cfg } = fakeMailchimp({ 'enrkay@gmail.com': ['paid_customer'] })
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', subject: 'Payment confirmation', preview: 'Thank you Lisa' })],
      cfg,
      POLICY,
    )
    expect(r.needsReview).toHaveLength(0)
  })

  it('还没打标签的人 → 照常进待办（证明上一条不是因为别的原因空的）', async () => {
    const { cfg } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead'] })
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', subject: 'Payment confirmation', preview: 'Thank you Lisa' })],
      cfg,
      POLICY,
    )
    expect(r.needsReview).toHaveLength(1)
  })

  it('🔴 查不到这个人（网络/404）→ 照常问，宁可多问一次也不漏', async () => {
    const { cfg } = fakeMailchimp({})
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', subject: 'Payment confirmation', preview: 'Thank you Lisa' })],
      cfg,
      POLICY,
    )
    expect(r.needsReview).toHaveLength(1)
  })
})

describe('runPaidTagging · 转发信降级', () => {
  it('🔴 Fw: 开头的确认信 → needs_review，不自动打（收件人可能是代理/同事）', async () => {
    const { cfg, writes } = fakeMailchimp({ 'agent@housesoftravel.co.nz': ['fb_lead'] })
    const r = await runPaidTagging(
      [mail({
        subject: 'Fw: New Reborn Lead: Nikki Smith',
        preview: 'Hi Sarah, Your payment has been received in full for Nikki.',
        counterparty: { address: 'agent@housesoftravel.co.nz', name: 'Sarah' },
      })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(r.needsReview).toHaveLength(1)
    expect(writes).toHaveLength(0)
  })
})

describe('runPaidTagging · 🔴 needs_review 处理确认闸（2026-09-08 每日待办自动闭环审计）', () => {
  it('PM 已经在 Mailchimp 打过 paidTag → 不再重复报 needs_review', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': ['paid_customer'] })
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', subject: 'Payment confirmation', preview: 'Get Outlook for Android' })],
      cfg,
      POLICY,
    )
    expect(r.needsReview).toHaveLength(0)
    expect(writes).toHaveLength(0) // 只反查，不写标签（那是自动打标签档的事）
  })

  it('还没打过标签 → 照常报 needs_review（回归：确认闸没把正常路径也挡掉）', async () => {
    const { cfg } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead'] })
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', subject: 'Payment confirmation', preview: 'Get Outlook for Android' })],
      cfg,
      POLICY,
    )
    expect(r.needsReview).toHaveLength(1)
  })

  it('同一个人两封 needs_review 信 → 只查 Mailchimp 一次（幂等短路）', async () => {
    let lookups = 0
    const impl = async (url: string): Promise<Response> => {
      if (url.includes('/tags')) return new Response(null, { status: 204 })
      lookups += 1
      return new Response(
        JSON.stringify({ email_address: 'enrkay@gmail.com', status: 'subscribed', tags: [] }),
        { status: 200 },
      )
    }
    const r = await runPaidTagging(
      [
        mail({ id: 'a', direction: 'inbound', subject: 'Payment confirmation', preview: 'Get Outlook for Android' }),
        mail({ id: 'b', direction: 'inbound', subject: 'Payment confirmation', preview: 'Get Outlook for Android' }),
      ],
      { ...CFG_BASE, fetchImpl: impl },
      POLICY,
    )
    expect(r.needsReview).toHaveLength(2)
    expect(lookups).toBe(1)
  })

  it('反查 Mailchimp 出错（限流/网络）→ 按"还没处理"算，照常报出来，不静默吞掉', async () => {
    const impl = async () => new Response(null, { status: 429 })
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', subject: 'Payment confirmation', preview: 'Get Outlook for Android' })],
      { ...CFG_BASE, fetchImpl: impl },
      POLICY,
    )
    expect(r.needsReview).toHaveLength(1)
  })

  it('🔴 Codex round 3：同一批里这个邮箱已经被本轮确认打过标签 → needs_review 排除它，也不再反查', async () => {
    let lookups = 0
    const { cfg } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead'] })
    const baseFetch = cfg.fetchImpl
    const impl = async (url: string, init?: RequestInit) => {
      if (!url.includes('/tags')) lookups += 1
      return baseFetch(url, init)
    }
    const r = await runPaidTagging(
      [
        // 一封我们自己确认收款的信，先把这个邮箱打上 paid_customer。
        mail({ id: 'confirmed', preview: 'Your payment has been received in full' }),
        // 同一批里客人自己也甩了张回单，命中 needs_review。
        mail({
          id: 'review',
          direction: 'inbound',
          subject: 'Payment confirmation',
          preview: 'Get Outlook for Android',
        }),
      ],
      { ...cfg, fetchImpl: impl },
      POLICY,
    )
    expect(r.tagged).toHaveLength(1)
    // 已经在本轮确认打过标签的邮箱不该再冒出来要人复核。
    expect(r.needsReview).toHaveLength(0)
    // 且不该为它多发一次反查请求——它已经在 alreadyTagged 里，查了也是白查。
    expect(lookups).toBe(1) // 只有 applyMemberTags 内部那一次 findMemberByEmail
  })

  it('🔴 Codex round 3：共享的 reviewCheckDeadline 已过期 → 不再发起新反查，仍按"还没处理"报出来', async () => {
    let lookups = 0
    const impl = async (url: string): Promise<Response> => {
      if (url.includes('/tags')) return new Response(null, { status: 204 })
      lookups += 1
      return new Response(
        JSON.stringify({ email_address: 'enrkay@gmail.com', status: 'subscribed', tags: [] }),
        { status: 200 },
      )
    }
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', subject: 'Payment confirmation', preview: 'Get Outlook for Android' })],
      { ...CFG_BASE, fetchImpl: impl },
      POLICY,
      { reviewCheckDeadline: Date.now() - 1 },
    )
    expect(r.needsReview).toHaveLength(1)
    expect(lookups).toBe(0)
  })
})

describe('runPaidTagging · 出错时如实报数', () => {
  it('Mailchimp 500 → 记 errors 且标可重试，不假装成功', async () => {
    const impl = async (url: string) =>
      url.includes('/tags') ? new Response(null, { status: 500 }) : new Response(
        JSON.stringify({ email_address: 'enrkay@gmail.com', status: 'subscribed', tags: [] }), { status: 200 })
    const r = await runPaidTagging(
      [mail({ preview: 'Your payment has been received in full' })],
      { ...CFG_BASE, fetchImpl: impl },
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(r.errors).toEqual([{ email: 'enrkay@gmail.com', reason: 'http_500', retryable: true }])
  })
})
