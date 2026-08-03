import { describe, it, expect } from 'vitest'
import { pickEligible, RERUN_COOLDOWN_DAYS, type EligibleClient } from './scheduled-run'

const NOW = new Date('2026-08-03T00:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

const c = (id: string, name: string, domain: string | null): EligibleClient => ({ id, name, domain })

describe('pickEligible —— 选错客户是这条链上最贵的错', () => {
  it('🔴 没域名的不跑 —— 内部账号(Magic Lab 这类)没网站，采集器无从下手，跑了纯烧钱', () => {
    const { run } = pickEligible(
      [c('1', 'CTS', 'ctstours.co.nz'), c('2', 'Magic Lab', null), c('3', 'Magic Engine', '  ')],
      new Map(),
      NOW,
    )
    expect(run.map((x) => x.name)).toEqual(['CTS'])
  })

  it('冷却期内刚跑过的跳过，并说清楚为什么', () => {
    const { run, skipped } = pickEligible(
      [c('1', 'CTS', 'ctstours.co.nz')],
      new Map([['1', daysAgo(2)]]),
      NOW,
    )
    expect(run).toEqual([])
    expect(skipped[0].result).toBe('skipped_recent')
    expect(skipped[0].detail).toContain('冷却')
  })

  it('超过冷却期就跑', () => {
    const { run } = pickEligible(
      [c('1', 'CTS', 'ctstours.co.nz')],
      new Map([['1', daysAgo(RERUN_COOLDOWN_DAYS + 1)]]),
      NOW,
    )
    expect(run).toHaveLength(1)
  })

  it('从没跑过的直接跑', () => {
    const { run } = pickEligible([c('1', 'CTS', 'ctstours.co.nz')], new Map(), NOW)
    expect(run).toHaveLength(1)
  })

  it('🔴 没域名的**不进 skipped** —— 它不是「这次跳过」，是压根不适用，别在报告里刷屏', () => {
    const { run, skipped } = pickEligible([c('2', 'Magic Lab', null)], new Map(), NOW)
    expect(run).toEqual([])
    expect(skipped).toEqual([])
  })

  it('多客户混合场景', () => {
    const { run, skipped } = pickEligible(
      [
        c('1', 'CTS', 'ctstours.co.nz'),
        c('2', 'Oztop', 'oztopbuildingsupplies.com.au'),
        c('3', 'Magic Lab', null),
        c('4', 'Roman', 'romanhu.com'),
      ],
      new Map([['2', daysAgo(1)]]),
      NOW,
    )
    expect(run.map((x) => x.name)).toEqual(['CTS', 'Roman'])
    expect(skipped.map((x) => x.clientName)).toEqual(['Oztop'])
  })

  it('空输入不炸', () => {
    expect(pickEligible([], new Map(), NOW)).toEqual({ run: [], skipped: [] })
  })
})
