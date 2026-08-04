import { describe, it, expect } from 'vitest'
import { pickEligible, RERUN_COOLDOWN_DAYS, type EligibleClient } from './scheduled-run'

const NOW = new Date('2026-08-03T00:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

const c = (
  id: string,
  name: string,
  domain: string | null,
  industry: string | null,
): EligibleClient => ({ id, name, domain, industry })

/**
 * 🔴 这些是 2026-08-04 从生产库直接抄下来的真值，别改成"看起来合理"的假数据。
 *
 * 首版测试给三个内部账号填的 domain 是 null，于是"没域名就不跑"这条门槛测试全绿 ——
 * 而生产库里它们**全都有域名**，门槛压根没拦住任何东西。单测绿灯 ≠ 现实成立。
 */
const PROD_ACTIVE: EligibleClient[] = [
  c('cts', 'CTS Tours NZ', 'ctstours.co.nz', 'travel'),
  c('me', 'Magic Engine', 'magicengine.com.au', null),
  c('ml', 'Magic Lab', 'magiclab.onrender.com', null),
  c('mlc', 'Magic Lab Class', 'bigray.ai', null),
  c('oz', 'oztop', 'oztopbuildingsupplies.com.au', 'flooring'),
  c('roman', 'Roman HU', 'www.romanhu.com', 'real_estate'),
]

describe('pickEligible —— 选错客户是这条链上最贵的错', () => {
  it('🔴 拿真实的 6 个 active 客户跑：只有 3 个真客户该跑，3 个内部账号必须被挡下', () => {
    const { run, skipped } = pickEligible(PROD_ACTIVE, new Map(), NOW)
    expect(run.map((x) => x.name).sort()).toEqual(['CTS Tours NZ', 'Roman HU', 'oztop'])
    expect(skipped.map((x) => x.clientName).sort()).toEqual([
      'Magic Engine',
      'Magic Lab',
      'Magic Lab Class',
    ])
    expect(skipped.every((s) => s.result === 'skipped_no_industry')).toBe(true)
  })

  it('🔴 被当成内部账号挡下的必须留下原因 —— 万一是真客户漏填行业，要看得见', () => {
    const { skipped } = pickEligible(
      [c('x', '某新客户', 'newclient.co.nz', null)],
      new Map(),
      NOW,
    )
    expect(skipped).toHaveLength(1)
    expect(skipped[0].detail).toContain('行业')
  })

  it('填了行业就开始跑 —— 这是漏填客户的自救路径', () => {
    const { run } = pickEligible([c('x', '某新客户', 'newclient.co.nz', 'travel')], new Map(), NOW)
    expect(run).toHaveLength(1)
  })

  it('没域名的不跑 —— 没网站，SEO/竞品采集器无从下手', () => {
    const { run } = pickEligible(
      [c('1', 'CTS', 'ctstours.co.nz', 'travel'), c('2', '无网站客户', null, 'travel'), c('3', '空白域名', '  ', 'travel')],
      new Map(),
      NOW,
    )
    expect(run.map((x) => x.name)).toEqual(['CTS'])
  })

  it('冷却期内刚跑过的跳过，并说清楚为什么', () => {
    const { run, skipped } = pickEligible(
      [c('1', 'CTS', 'ctstours.co.nz', 'travel')],
      new Map([['1', daysAgo(2)]]),
      NOW,
    )
    expect(run).toEqual([])
    expect(skipped[0].result).toBe('skipped_recent')
    expect(skipped[0].detail).toContain('冷却')
  })

  it('超过冷却期就跑', () => {
    const { run } = pickEligible(
      [c('1', 'CTS', 'ctstours.co.nz', 'travel')],
      new Map([['1', daysAgo(RERUN_COOLDOWN_DAYS + 1)]]),
      NOW,
    )
    expect(run).toHaveLength(1)
  })

  it('从没跑过的直接跑', () => {
    const { run } = pickEligible([c('1', 'CTS', 'ctstours.co.nz', 'travel')], new Map(), NOW)
    expect(run).toHaveLength(1)
  })

  it('🔴 没域名的**不进 skipped** —— 它不是「这次跳过」，是压根不适用，别在报告里刷屏', () => {
    const { run, skipped } = pickEligible([c('2', '无网站客户', null, 'travel')], new Map(), NOW)
    expect(run).toEqual([])
    expect(skipped).toEqual([])
  })

  it('多客户混合场景', () => {
    const { run, skipped } = pickEligible(
      [
        c('1', 'CTS', 'ctstours.co.nz', 'travel'),
        c('2', 'Oztop', 'oztopbuildingsupplies.com.au', 'flooring'),
        c('3', 'Magic Lab', 'magiclab.onrender.com', null),
        c('4', 'Roman', 'romanhu.com', 'real_estate'),
      ],
      new Map([['2', daysAgo(1)]]),
      NOW,
    )
    expect(run.map((x) => x.name)).toEqual(['CTS', 'Roman'])
    expect(skipped.map((x) => x.clientName).sort()).toEqual(['Magic Lab', 'Oztop'])
  })

  it('空输入不炸', () => {
    expect(pickEligible([], new Map(), NOW)).toEqual({ run: [], skipped: [] })
  })
})
