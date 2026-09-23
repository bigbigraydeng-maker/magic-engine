/**
 * 「客人填了表还没人回」汇总信测试。
 *
 * 测的是文件头那四条约束有没有真的执行到位 —— 尤其是「数字不许说小」和
 * 「必须说出跟后台那一页口径不同」，这两条只写在注释里是没用的。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  LEAD_DIGEST_TEST_PREFIX,
  buildLeadDigestBody,
  buildLeadDigestSubject,
  sendLeadFollowupDigest,
} from '../lead-followup-digest'
import type { LeadDueItem } from '../lead-followup-due'
import type { DigestMailer } from '../digest-shared'
import { ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'

const NOW = new Date('2026-09-24T00:00:00Z')

function item(over: Partial<LeadDueItem> = {}): LeadDueItem {
  return {
    clientId: 'c0000000-0000-0000-0000-000000000000',
    contactId: 'p1',
    displayName: '王女士',
    interest: 'Best of China',
    leadAt: '2026-09-22T00:00:00Z',
    ...over,
  }
}

function fakeMailer(): { mailer: DigestMailer; sent: Array<{ to: string[]; subject: string; html: string; from: string }> } {
  const sent: Array<{ to: string[]; subject: string; html: string; from: string }> = []
  return {
    sent,
    mailer: {
      emails: {
        send: vi.fn(async (p: { from: string; to: string[]; subject: string; html: string }) => {
          sent.push(p)
          return { error: null }
        }),
      },
    },
  }
}

describe('正文', () => {
  it('第一段就自报「测试中」，并说清楚它不会替谁联系客人', () => {
    const html = buildLeadDigestBody('CTS Tours NZ', [item()], NOW, 7)
    expect(html).toContain(LEAD_DIGEST_TEST_PREFIX)
    expect(html).toContain('不会替任何人联系客人')
  })

  it('列出名字、感兴趣的团、等了多久、直达链接', () => {
    const html = buildLeadDigestBody('CTS Tours NZ', [item()], NOW, 7)
    expect(html).toContain('王女士')
    expect(html).toContain('Best of China')
    expect(html).toContain('2 天')
    expect(html).toContain('/dashboard/clients/c0000000-0000-0000-0000-000000000000/crm/all?contact=p1')
  })

  it('没选团的说「他没有在表单里选想去哪条线」，不留空', () => {
    expect(buildLeadDigestBody('X', [item({ interest: null })], NOW, 7)).toContain('没有在表单里选')
  })

  it('🔴 名字本身是个邮箱地址时，只留 @ 前那一截 —— 别把联系方式抄进一封会被转发的信', () => {
    const html = buildLeadDigestBody('X', [item({ displayName: 'wang.customer@gmail.com' })], NOW, 7)
    expect(html).toContain('wang.customer')
    expect(html).not.toContain('@gmail.com')
  })

  it('🔴 被上限压掉的条数必须说出来', () => {
    expect(buildLeadDigestBody('X', [item()], NOW, 7, { dropped: 12 })).toContain('12')
  })

  it('🔴 窗口之外的积压必须说出来，并且点明「补不补是单独的决定」', () => {
    const html = buildLeadDigestBody('X', [item()], NOW, 7, { backlog: 277 })
    expect(html).toContain('277')
    expect(html).toContain('单独的决定')
  })

  it('没有积压时不出现那段红框', () => {
    expect(buildLeadDigestBody('X', [item()], NOW, 7, { backlog: 0 })).not.toContain('更早以前还有')
  })

  it('🔴 必须解释「为什么这个名单比后台那一页长」—— 否则看的人以为系统坏了', () => {
    const html = buildLeadDigestBody('X', [item()], NOW, 7)
    expect(html).toContain('为什么这个名单比后台')
    expect(html).toContain('AI 客服')
  })

  it('等最久的排最前', () => {
    const html = buildLeadDigestBody(
      'X',
      [item({ contactId: 'new', displayName: '新来的', leadAt: '2026-09-23T00:00:00Z' }),
       item({ contactId: 'old', displayName: '等最久的', leadAt: '2026-09-18T00:00:00Z' })],
      NOW,
      7,
    )
    expect(html.indexOf('等最久的')).toBeLessThan(html.indexOf('新来的'))
  })

  it('客人名字里的 HTML 被转义', () => {
    expect(buildLeadDigestBody('X', [item({ displayName: '<script>x</script>' })], NOW, 7))
      .not.toContain('<script>')
  })
})

describe('主题', () => {
  it('数字是总数（含被压掉的），不是名单长度', () => {
    expect(buildLeadDigestSubject('CTS Tours NZ', 20)).toBe(
      `${LEAD_DIGEST_TEST_PREFIX}CTS Tours NZ：20 个客人填了表还没人回`,
    )
  })
})

describe('发送', () => {
  it('一条都没有就不发 —— 不发「今天很干净」那种信', async () => {
    const { mailer, sent } = fakeMailer()
    const r = await sendLeadFollowupDigest('X', [], { apiKey: 'k', mailerFactory: () => mailer })
    expect(r.sent).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('🔴 没给收件人就退回 ME 自己的信箱，绝不猜客户地址', async () => {
    const { mailer, sent } = fakeMailer()
    const r = await sendLeadFollowupDigest('X', [item()], { apiKey: 'k', mailerFactory: () => mailer })
    expect(r.sent).toBe(true)
    expect(sent[0].to).toEqual([ME_MAIL_TO_ADDRESS])
  })

  it('传了空数组也退回 ME 自己的信箱', async () => {
    const { mailer, sent } = fakeMailer()
    await sendLeadFollowupDigest('X', [item()], { recipients: [], apiKey: 'k', mailerFactory: () => mailer })
    expect(sent[0].to).toEqual([ME_MAIL_TO_ADDRESS])
  })

  it('没有 API key 时如实说原因，不假装发了', async () => {
    const r = await sendLeadFollowupDigest('X', [item()], { apiKey: '' })
    expect(r.sent).toBe(false)
    expect(r.reason).toContain('RESEND_API_KEY')
  })

  it('发信通道抛异常时不往上炸 —— 上游那趟巡检不该被带崩', async () => {
    const r = await sendLeadFollowupDigest('X', [item()], {
      apiKey: 'k',
      mailerFactory: () => ({ emails: { send: async () => { throw new Error('网络挂了') } } }),
    })
    expect(r.sent).toBe(false)
    expect(r.reason).toBe('网络挂了')
  })
})
