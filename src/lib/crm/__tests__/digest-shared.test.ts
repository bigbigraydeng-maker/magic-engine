/**
 * 两封汇总信共用的那几件小东西。
 *
 * 为什么单独测：`stripAddress` / `scrubContactDetails` 是「正文不写客人联系方式」
 * 这条纪律的**唯一执行点**，抽成共用层之后两封信都靠它。之前它只被各封信的
 * HTML 断言间接碰到 —— 改一处会同时改掉两封信，却没有一条测试直接盯着它
 * （魏征复审 2026-09-24）。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  APP_BASE,
  contactUrl,
  esc,
  humanWait,
  scrubContactDetails,
  sendDigestMail,
  stripAddress,
  digestName,
  type DigestMailer,
} from '../digest-shared'

describe('esc', () => {
  it('挡住标签注入', () => {
    expect(esc('<script>&"x"</script>')).toBe('&lt;script&gt;&amp;"x"&lt;/script&gt;')
  })
})

describe('stripAddress —— 名字本身是个邮箱地址时', () => {
  it('只留 @ 前那一截，还能认人', () => {
    expect(stripAddress('wang.customer@gmail.com')).toBe('wang.customer')
  })
  it('名字里夹着地址时，域名掐掉、@ 前那一截留着（还能认人，但已经不是可直接发信的地址）', () => {
    expect(stripAddress('Wang (wang@x.co.nz)')).toBe('Wang (wang)')
  })
  it('掐完什么都不剩时才退回「未留姓名」', () => {
    expect(stripAddress('a@b.com')).toBe('a')
    expect(stripAddress('   ')).toBe('未留姓名')
  })
  it('正常名字原样放行', () => {
    expect(stripAddress('王女士')).toBe('王女士')
  })
})

describe('scrubContactDetails —— 客人自己打的自由文本', () => {
  it('掐掉电话号码，保留有用的话', () => {
    expect(scrubContactDetails('想去黄石，电话 021 555 8899')).toBe('想去黄石，电话 （号码略）')
  })
  it('掐掉邮箱', () => {
    expect(scrubContactDetails('联系 me@x.com 谢谢')).toBe('联系 me 谢谢')
  })
  it('短数字不误伤 —— 「2027 年」不是电话', () => {
    expect(scrubContactDetails('2027 年 3 月的团')).toBe('2027 年 3 月的团')
  })
  it('下拉选项那种 slug 原样放行', () => {
    expect(scrubContactDetails('best_of_china_-_march_2027')).toBe('best_of_china_-_march_2027')
  })
})

describe('humanWait', () => {
  it.each([
    [30 * 60_000, '不到 1 小时'],
    [5 * 3_600_000, '5 小时'],
    [48 * 3_600_000, '2 天'],
    [51 * 3_600_000, '2 天 3 小时'],
  ])('%i ms → %s', (ms, expected) => {
    expect(humanWait(ms)).toBe(expected)
  })
  it('🔴 算不出来时说「时间不详」，不显示 NaN、更不把这条丢掉', () => {
    expect(humanWait(Number.NaN)).toBe('时间不详')
  })
})

describe('contactUrl', () => {
  it('🔴 必须是绝对网址 —— 相对路径会被链接闸判成 broken，整条被丢掉', () => {
    expect(contactUrl('c1', 'p1')).toBe(`${APP_BASE}/dashboard/clients/c1/crm/all?contact=p1`)
    expect(contactUrl('c1', 'p1').startsWith('https://')).toBe(true)
  })
  it('id 里的特殊字符要转义', () => {
    expect(contactUrl('a/b', 'c&d')).toContain('a%2Fb')
    expect(contactUrl('a/b', 'c&d')).toContain('c%26d')
  })
})

describe('sendDigestMail', () => {
  type SendPayload = { from: string; to: string[]; subject: string; html: string }
  function mailer(result: { error: unknown; data?: { id?: string } | null }) {
    const send = vi.fn<(p: SendPayload) => Promise<typeof result>>(async () => result)
    return { send, mailer: { emails: { send } } as unknown as DigestMailer }
  }
  const base = { fromLabel: 'X', recipients: ['a@b.test'], subject: 's', html: '<p>h</p>' }

  it('成功时带回发信服务的凭据 id', async () => {
    const m = mailer({ error: null, data: { id: 'msg_9' } })
    expect(await sendDigestMail({ ...base, apiKey: 'k', mailerFactory: () => m.mailer }))
      .toEqual({ sent: true, recipients: ['a@b.test'], messageId: 'msg_9' })
  })

  it('发信服务没给 id 时不编一个', async () => {
    const m = mailer({ error: null, data: null })
    const r = await sendDigestMail({ ...base, apiKey: 'k', mailerFactory: () => m.mailer })
    expect(r.sent).toBe(true)
    expect(r.messageId).toBeUndefined()
  })

  it('没有 API key 时如实说原因，不假装发了', async () => {
    const r = await sendDigestMail({ ...base, apiKey: '' })
    expect(r).toEqual({ sent: false, reason: 'RESEND_API_KEY 未配置', recipients: ['a@b.test'] })
  })

  it('发信服务报错时把原因说人话带回来', async () => {
    const m = mailer({ error: { statusCode: 403, name: 'forbidden', message: '域名没验证' } })
    const r = await sendDigestMail({ ...base, apiKey: 'k', mailerFactory: () => m.mailer })
    expect(r.sent).toBe(false)
    expect(r.reason).toContain('403')
    expect(r.reason).toContain('域名没验证')
  })

  it('🔴 通道抛异常时不往上炸 —— 上游那趟巡检不该被发信带崩', async () => {
    const r = await sendDigestMail({
      ...base,
      apiKey: 'k',
      mailerFactory: () => ({ emails: { send: async () => { throw new Error('网络挂了') } } }),
    })
    expect(r).toEqual({ sent: false, reason: '网络挂了', recipients: ['a@b.test'] })
  })

  it('From 带上人类看得懂的标签，发件地址是已验证域名那一个', async () => {
    const m = mailer({ error: null })
    await sendDigestMail({ ...base, fromLabel: 'Magic Engine 表单线索提醒', apiKey: 'k', mailerFactory: () => m.mailer })
    expect(m.send.mock.calls[0][0]).toMatchObject({ from: 'Magic Engine 表单线索提醒 <hello@magicengine.cloud>' })
  })
})

describe('digestName —— 摘要邮件里认人用的名字（给销售内部看，不是名字字段）', () => {
  it('名字是邮箱的老数据：退回 @ 前一截，销售还认得出是谁；绝不出现完整地址', () => {
    expect(digestName('wang.customer@gmail.com')).toBe('wang.customer')
    expect(digestName('wang.customer@gmail.com')).not.toContain('@')
  })
  it('真名原样；空 / 占位词 → 未留姓名', () => {
    expect(digestName('Jane Doe')).toBe('Jane Doe')
    expect(digestName(null)).toBe('未留姓名')
    expect(digestName('Facebook 用户')).toBe('未留姓名')
  })
})
