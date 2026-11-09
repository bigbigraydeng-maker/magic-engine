import { describe, it, expect } from 'vitest'
import {
  summariseFailures,
  summariseOutletGaps,
  summariseSyncProblems,
  buildLeadsSyncReceipts,
  classifyLeadsSyncOutcome,
  type LeadsSyncOutcome,
} from '../leads-sync-alert'

/**
 * 样本取自 2026-08-30 生产 `cron_run_logs` 的真实报错原文（4 个客户全挂 9 天，
 * 而 `error_message` 一直是 null，日报邮件只显示一个破折号）。
 */
const TOKEN_DEAD =
  'leadgen_forms HTTP 400: {"error":{"message":"Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.","type":"OAuthException","code":190,"error_subcode":460}}'
const NO_PERMISSION =
  'leadgen_forms HTTP 403: {"error":{"message":"(#200) Requires pages_manage_ads permission to manage the object","type":"OAuthException","code":200}}'

// 授权过期 / 权限不足属于 blocked（各有自己的待办盯着）；真失败用下面两种非授权报错。
const FETCH_TIMEOUT = 'leadgen_forms fetch failed: network timeout while reading lead forms for this page'
const SERVER_ERROR = 'leads HTTP 500: {"error":{"message":"Internal server error while listing leads","code":2}}'

const REAL_OUTAGE = [
  { clientName: 'Magic Lab Class', error: FETCH_TIMEOUT },
  { clientName: 'Roman HU', error: FETCH_TIMEOUT },
  { clientName: 'NZCPE 2026', error: FETCH_TIMEOUT },
  { clientName: 'CTS Tours NZ', error: SERVER_ERROR },
]

describe('classifyLeadsSyncOutcome', () => {
  it('已知坏令牌（等重连）算 blocked，不把整轮涂成失败', () => {
    expect(
      classifyLeadsSyncOutcome({
        clientName: 'Sample',
        skipped: 'connection_unhealthy',
        error: 'code=190',
      }).state,
    ).toBe('blocked')
  })
})

describe('summariseFailures', () => {
  it('全好时返回 undefined —— 否则每小时都会把健康的一跑标成失败', () => {
    expect(
      summariseFailures([{ clientName: 'CTS Tours NZ' }, { clientName: 'Roman HU' }]),
    ).toBeUndefined()
  })

  it('先报有多少家挂了', () => {
    expect(summariseFailures(REAL_OUTAGE)).toMatch(/^4\/4 个客户取不到线索/)
  })

  it('同一句报错的客户合并成一组 —— 一把令牌失效不该把 200 字符刷满四遍', () => {
    const out = summariseFailures(REAL_OUTAGE)!
    expect(out).toContain('Magic Lab Class/Roman HU/NZCPE 2026')
    // 同一句原因只出现一次
    expect(out.match(/network timeout/g)).toHaveLength(1)
  })

  it('病因不同的客户各自成组 —— 权限不足跟令牌失效修法不同，不能混成一句', () => {
    const out = summariseFailures(REAL_OUTAGE)!
    expect(out).toContain('CTS Tours NZ')
    expect(out).toContain('Internal server error')
  })

  it('日报邮件只截前 200 字符 —— 这 200 字符里必须能看出「是什么错」', () => {
    const head = summariseFailures(REAL_OUTAGE)!.slice(0, 200)
    expect(head).toMatch(/network timeout|Internal server error/)
  })

  it('单个客户的原因过长时截断，不让一家挤掉其他家', () => {
    const out = summariseFailures([
      { clientName: 'A', error: 'x'.repeat(500) },
      { clientName: 'B', error: 'short reason' },
    ])!
    expect(out).toContain('short reason')
    expect(out.length).toBeLessThan(400)
  })

  it('部分失败也要报 —— 一家断供就是一条线索管道断了', () => {
    const out = summariseFailures([
      { clientName: 'CTS Tours NZ', error: SERVER_ERROR },
      { clientName: 'Roman HU' },
    ])
    expect(out).toMatch(/^1\/2 个客户取不到线索/)
  })
})

/**
 * 「线索进来了，但没进邮件名单」—— 第二次静默事故的告警面。
 *
 * 2026-08~09：`clients.mailchimp_audience_id` 那一列没 apply 到生产，Mailchimp
 * 出口每小时都走 `client_config_read_failed` 静默 skip。`leadsIngested` 照常涨、
 * 一个客户都没报错，于是 `summariseFailures` 返回 undefined、cron 标 completed、
 * 日报根本不捞这次跑 —— 一整个月没有任何人看得见。
 *
 * 这里钉的是：这件事必须**说出来**，必须说的是「进了 CRM 没进名单」（不是
 * 「取不到线索」，那是假话），而且必须让非技术的 PM 一眼看懂。
 */
describe('summariseOutletGaps', () => {
  it('出口全好时返回 undefined —— 订阅成功不是问题', () => {
    expect(
      summariseOutletGaps([
        { clientName: 'CTS Tours NZ', mailchimp: { subscribed: 12, already_member: 3 } },
      ]),
    ).toBeUndefined()
  })

  it('没有 mailchimp 字段时返回 undefined —— 老记录 / 没有 lead 走到出口', () => {
    expect(summariseOutletGaps([{ clientName: 'CTS Tours NZ' }])).toBeUndefined()
    expect(summariseOutletGaps([{ clientName: 'CTS Tours NZ', mailchimp: {} }])).toBeUndefined()
  })

  it('「没配邮件出口 / 人没留邮箱 / 人明确不要」不算问题，绝不下发', () => {
    expect(
      summariseOutletGaps([
        {
          clientName: 'Oztop',
          mailchimp: {
            'skipped:no_audience_config': 5,
            'skipped:no_email': 4,
            'skipped:explicit_opt_out': 2,
            'skipped:contact_dnc': 1,
            'skipped:invalid_email': 1,
          },
        },
      ]),
    ).toBeUndefined()
  })

  it('复刻真实事故：报的是「进了 CRM 没进名单」和漏了多少人，不是「取不到线索」', () => {
    const out = summariseOutletGaps([
      { clientName: 'CTS Tours NZ', mailchimp: { subscribed: 0, 'skipped:client_config_read_failed': 12 } },
    ])!

    expect(out).toMatch(/^12 条线索进了 CRM 但没进邮件名单/)
    // 这句话不许出现在这里 —— 线索其实进来了，说「取不到」就是在日报里说假话
    expect(out).not.toContain('取不到线索')
    // PM 一眼看懂：不是术语，是「读不出配置」
    expect(out).toContain('CTS Tours NZ')
    expect(out).toContain('读不出这个客户的邮件名单配置')
    // 原始 key 不该糊到 PM 脸上
    expect(out).not.toContain('client_config_read_failed')
  })

  it('同一个死因打中多家时合并成一组 —— 否则 200 字符被同一句话刷满', () => {
    const out = summariseOutletGaps([
      { clientName: 'CTS Tours NZ', mailchimp: { 'failed:auth': 8 } },
      { clientName: 'Roman HU', mailchimp: { 'failed:auth': 5 } },
      { clientName: 'Oztop', mailchimp: { 'skipped:client_config_read_failed': 2 } },
    ])!

    expect(out).toMatch(/^15 条线索进了 CRM 但没进邮件名单/)
    expect(out).toContain('CTS Tours NZ/Roman HU: Mailchimp 不认这个密钥 13 条')
    expect(out.match(/Mailchimp 不认这个密钥/g)).toHaveLength(1)
    expect(out).toContain('Oztop: 读不出这个客户的邮件名单配置 2 条')
  })

  it('没见过的 reason 照原样带出来 —— 新失败宁可吵一次，也绝不静默咽掉', () => {
    const out = summariseOutletGaps([
      { clientName: 'CTS Tours NZ', mailchimp: { 'failed:brand_new_reason': 3 } },
    ])!

    expect(out).toContain('failed:brand_new_reason')
    expect(out).toContain('3 条')
  })

  it('计数为 0 的 key 不算 —— 有这个键不等于真漏了人', () => {
    expect(
      summariseOutletGaps([{ clientName: 'CTS', mailchimp: { 'failed:auth': 0, subscribed: 3 } }]),
    ).toBeUndefined()

    // 别家真漏了人的时候也一样：0 条的那个原因不许混进句子里凑数
    const out = summariseOutletGaps([
      { clientName: 'CTS', mailchimp: { 'failed:auth': 0 } },
      { clientName: 'Roman HU', mailchimp: { 'failed:timeout': 4 } },
    ])!
    expect(out).toMatch(/^4 条线索进了 CRM 但没进邮件名单/)
    expect(out).not.toContain('Mailchimp 不认这个密钥')
    expect(out).not.toContain('CTS')
  })

  it('客户名缺失时也报，不因为没名字就丢掉一整组', () => {
    const out = summariseOutletGaps([{ clientName: null, mailchimp: { 'failed:timeout': 2 } }])!
    expect(out).toContain('(未命名客户)')
  })
})

describe('summariseSyncProblems —— 两类病分开成句', () => {
  it('都好时 undefined，这次跑仍标 completed', () => {
    expect(
      summariseSyncProblems([{ clientName: 'CTS Tours NZ', mailchimp: { subscribed: 3 } }]),
    ).toBeUndefined()
  })

  it('只有取不到线索时，句子跟以前一模一样 —— 老告警行为不许被这次改动动到', () => {
    expect(summariseSyncProblems(REAL_OUTAGE)).toBe(summariseFailures(REAL_OUTAGE))
  })

  it('只有出口坏掉时也必须出一句 —— 否则 status 不是 failed，日报根本不捞这次跑', () => {
    const out = summariseSyncProblems([
      { clientName: 'CTS Tours NZ', mailchimp: { 'skipped:client_config_read_failed': 12 } },
    ])!

    expect(out).toMatch(/^12 条线索进了 CRM 但没进邮件名单/)
  })

  it('两类同时发生：取不到线索排前面（更严重，且邮件只截前 200 字符），两句都在', () => {
    const out = summariseSyncProblems([
      { clientName: 'Roman HU', error: SERVER_ERROR },
      { clientName: 'CTS Tours NZ', mailchimp: { 'failed:auth': 6 } },
    ])!

    expect(out).toMatch(/^1\/2 个客户取不到线索/)
    expect(out).toContain('；6 条线索进了 CRM 但没进邮件名单')
    expect(out).toContain('Mailchimp 不认这个密钥')
  })

  it('出口坏掉不改变「取不到线索的客户数」—— failed_count 的语义不许被污染', () => {
    const results: LeadsSyncOutcome[] = [
      { clientName: 'CTS Tours NZ', mailchimp: { 'failed:auth': 6 } },
      { clientName: 'Roman HU', mailchimp: { subscribed: 2 } },
    ]
    // route.ts 的 failed 就是这个算法；出口 tally 不参与
    expect(results.filter((r) => 'error' in r).length).toBe(0)
    expect(summariseFailures(results)).toBeUndefined()
    expect(summariseSyncProblems(results)).toBeDefined()
  })
})

describe('逐客户回执（blocked vs failed）', () => {
  const PAGE_BLOCKED: LeadsSyncOutcome = {
    clientId: 'c-nal',
    clientName: 'NAL',
    error: 'unverified_shared_token',
    skipped: 'page_not_verified',
  }

  it('没报错 = ok', () => {
    expect(classifyLeadsSyncOutcome({ clientId: 'c1', clientName: 'CTS Tours NZ' })).toEqual({
      clientId: 'c1',
      clientName: 'CTS Tours NZ',
      state: 'ok',
      detail: null,
    })
  })

  it('授权过期（190）= blocked，不是 failed', () => {
    expect(classifyLeadsSyncOutcome({ clientName: 'Magic Lab Class', error: TOKEN_DEAD }).state).toBe('blocked')
  })

  it('权限不足（200）= blocked', () => {
    expect(classifyLeadsSyncOutcome({ clientName: 'X', error: NO_PERMISSION }).state).toBe('blocked')
  })

  it('主页绑定未核实 = blocked', () => {
    expect(classifyLeadsSyncOutcome(PAGE_BLOCKED).state).toBe('blocked')
  })

  it('同一客户授权错混着真错误 = failed，不被授权错吞掉', () => {
    expect(
      classifyLeadsSyncOutcome({ clientName: 'X', error: `${TOKEN_DEAD} | 表单 123 整体失败: ${SERVER_ERROR}` }).state,
    ).toBe('failed')
  })

  it('全是授权错的多表单报错 = blocked', () => {
    expect(classifyLeadsSyncOutcome({ clientName: 'X', error: `${TOKEN_DEAD} | ${NO_PERMISSION}` }).state).toBe('blocked')
  })

  it('OAuthException 但是限流/参数错误 = failed，不冒充授权失效', () => {
    const e = '{"error":{"type":"OAuthException","code":100,"message":"Invalid parameter"}}'
    expect(classifyLeadsSyncOutcome({ clientName: 'X', error: e }).state).toBe('failed')
  })

  it('被跳过但没报错（缺主页令牌）= blocked，不是 ok', () => {
    const r = classifyLeadsSyncOutcome({ clientName: 'X', skipped: 'no_page_token' })
    expect(r.state).toBe('blocked')
    expect(r.detail).toBe('no_page_token')
  })

  it('一家 blocked + 另一家出口缺口：出口那句照样出，整轮仍有错误句', () => {
    const out = summariseSyncProblems([
      { clientName: 'Magic Lab Class', error: TOKEN_DEAD },
      { clientName: 'CTS Tours NZ', mailchimp: { 'failed:auth': 6 } },
    ])!
    expect(out).toMatch(/^6 条线索进了 CRM 但没进邮件名单/)
    expect(out).not.toContain('取不到线索')
  })

  it('其他报错 = failed，原话带进 detail', () => {
    const r = classifyLeadsSyncOutcome({ clientName: 'X', error: FETCH_TIMEOUT })
    expect(r.state).toBe('failed')
    expect(r.detail).toBe(FETCH_TIMEOUT)
  })

  it('别人 blocked，CTS 照样 ok，整轮不出失败句（CTS 不再被别人的错染红）', () => {
    const results: LeadsSyncOutcome[] = [
      { clientId: 'cts', clientName: 'CTS Tours NZ' },
      { clientId: 'mlc', clientName: 'Magic Lab Class', error: TOKEN_DEAD },
      PAGE_BLOCKED,
    ]
    const receipts = buildLeadsSyncReceipts(results)
    expect(receipts.map((r) => r.state)).toEqual(['ok', 'blocked', 'blocked'])
    expect(summariseFailures(results)).toBeUndefined()
    expect(summariseSyncProblems(results)).toBeUndefined()
  })

  it('blocked 和真失败并存时，只有真失败进错误句', () => {
    const out = summariseFailures([
      { clientName: 'Magic Lab Class', error: TOKEN_DEAD },
      { clientName: 'Roman HU', error: FETCH_TIMEOUT },
    ])!
    expect(out).toMatch(/^1\/2 个客户取不到线索/)
    expect(out).not.toContain('Magic Lab Class')
  })
})
