import { describe, it, expect } from 'vitest'
import {
  buildMetaAudienceA,
  audienceToCsv,
  type AudienceContact,
} from '../audience-export'

function c(over: Partial<AudienceContact> = {}): AudienceContact {
  return {
    displayName: 'Rosalind Vane',
    email: 'rosalind@example.com',
    phone: '021 555 1234',
    kind: 'retail',
    fromAd: true,
    doNotContact: false,
    ...over,
  }
}

describe('名单 A 口径（四道筛，每道都对应一个复审必改）', () => {
  it('正常终端客户进名单，电话转国际格式', () => {
    const r = buildMetaAudienceA([c()], '64')
    expect(r.stats.kept).toBe(1)
    expect(r.rows[0]).toMatchObject({ email: 'rosalind@example.com', phone: '64215551234', country: 'nz' })
  })

  it('🔴 agent（trade）不进 —— 否则 Meta 会去找更多旅行社', () => {
    const r = buildMetaAudienceA([c({ kind: 'trade' })], '64')
    expect(r.stats.kept).toBe(0)
    expect(r.stats.excluded_not_retail).toBe(1)
  })

  it('🔴 员工（staff）不进', () => {
    const r = buildMetaAudienceA([c({ kind: 'staff' })], '64')
    expect(r.stats.excluded_not_retail).toBe(1)
  })

  it('🔴 没同意（不是广告来源）不进', () => {
    const r = buildMetaAudienceA([c({ fromAd: false })], '64')
    expect(r.stats.kept).toBe(0)
    expect(r.stats.excluded_no_consent).toBe(1)
  })

  it('🔴 拒联的不进', () => {
    const r = buildMetaAudienceA([c({ doNotContact: true })], '64')
    expect(r.stats.excluded_dnc).toBe(1)
  })

  it('邮箱电话都没有的不进（发出去 100% 匹配不上）', () => {
    const r = buildMetaAudienceA([c({ email: null, phone: null })], '64')
    expect(r.stats.excluded_no_key).toBe(1)
  })

  it('只有电话也进', () => {
    const r = buildMetaAudienceA([c({ email: null })], '64')
    expect(r.stats.kept).toBe(1)
    expect(r.rows[0].email).toBe('')
    expect(r.rows[0].phone).toBe('64215551234')
  })

  it('拿不到国家码时本地电话丢掉；若也没邮箱则整条不进', () => {
    // 猜错国家的哈希会匹配到别人 —— 宁可丢。
    const r = buildMetaAudienceA([c({ email: null })], null)
    expect(r.stats.excluded_no_key).toBe(1)
  })
})

describe('排除理由一条只数一次（顺序即优先级）', () => {
  it('既是 agent 又拒联 → 只算进 not_retail', () => {
    const r = buildMetaAudienceA([c({ kind: 'trade', doNotContact: true })], '64')
    expect(r.stats.excluded_not_retail).toBe(1)
    expect(r.stats.excluded_dnc).toBe(0)
  })

  it('拒联优先于没同意（拒联是更硬的排除）', () => {
    const r = buildMetaAudienceA([c({ doNotContact: true, fromAd: false })], '64')
    expect(r.stats.excluded_dnc).toBe(1)
    expect(r.stats.excluded_no_consent).toBe(0)
  })
})

describe('统计数字对得上（给 PM 核对池子怎么缩的）', () => {
  it('各项加起来等于总数', () => {
    const list = [
      c(),
      c({ kind: 'trade' }),
      c({ doNotContact: true }),
      c({ fromAd: false }),
      c({ email: null, phone: null }),
    ]
    const { stats } = buildMetaAudienceA(list, '64')
    const sum =
      stats.kept +
      stats.excluded_not_retail +
      stats.excluded_no_consent +
      stats.excluded_dnc +
      stats.excluded_no_key
    expect(sum).toBe(stats.total)
    expect(stats.total).toBe(5)
    expect(stats.kept).toBe(1)
  })
})

describe('CSV', () => {
  it('表头是 Meta 认得的列', () => {
    const csv = audienceToCsv([])
    expect(csv.split('\n')[0]).toBe('email,phone,fn,ln,country')
  })

  it('姓名含逗号时正确转义', () => {
    const r = buildMetaAudienceA([c({ displayName: 'Vane, Rosalind' })], '64')
    const csv = audienceToCsv(r.rows)
    // "vane," 会被拆成 fn="vane," → 必须加引号，否则列错位
    expect(csv).toContain('"vane,"')
  })

  it('姓名转小写（跟哈希前规范化一致）', () => {
    const r = buildMetaAudienceA([c({ displayName: 'Rosalind Vane' })], '64')
    expect(r.rows[0].fn).toBe('rosalind')
    expect(r.rows[0].ln).toBe('vane')
  })

  it('单名只填 fn，ln 空', () => {
    const r = buildMetaAudienceA([c({ displayName: 'Cher' })], '64')
    expect(r.rows[0].fn).toBe('cher')
    expect(r.rows[0].ln).toBe('')
  })
})

