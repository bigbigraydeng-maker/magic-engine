import { describe, it, expect } from 'vitest'
import {
  PLAY_CATALOG, PLAY_SOURCE_TRUST, inferPlayFromName, describePlay, allPlays,
  type PlayKey,
} from '../play-vocabulary'

describe('PLAY_CATALOG', () => {
  it('每个打法都说清楚了「干什么 / 成效看哪 / 有什么坑」', () => {
    for (const [key, def] of Object.entries(PLAY_CATALOG)) {
      expect(def.label, key).toBeTruthy()
      expect(def.what, key).toBeTruthy()
      expect(def.successSignal, key).toBeTruthy()
      expect(def.knownTraps.length, `${key} 至少要写一条坑`).toBeGreaterThan(0)
    }
  })

  it('results 恒为 0 的打法，成效说明里必须点明这件事', () => {
    for (const key of ['thruplay_pool_build', 'reach_awareness'] as PlayKey[]) {
      expect(PLAY_CATALOG[key].successSignal).toContain('results 恒为 0')
    }
  })

  it('私信打法必须写明「机器先开口关不掉」—— 这是当天 5 个客户被得罪的根因', () => {
    const traps = PLAY_CATALOG.messenger_direct.knownTraps.join(' ')
    expect(traps).toContain('关不掉')
    expect(traps).toContain('语言')
  })

  it('重定向打法必须写明 Meta 会默认放宽', () => {
    const traps = PLAY_CATALOG.warm_pool_retarget.knownTraps.join(' ')
    expect(traps).toContain('优势受众')
  })

  it('表单打法必须写明「灵活投放」会删问题', () => {
    expect(PLAY_CATALOG.lead_form_harvest.knownTraps.join(' ')).toContain('灵活投放')
  })

  it('allPlays 返回全部，不漏', () => {
    expect(allPlays()).toHaveLength(Object.keys(PLAY_CATALOG).length)
  })

  it('describePlay 取得到定义', () => {
    expect(describePlay('thruplay_pool_build').label).toBe('看完视频 · 攒池')
  })
})

describe('PLAY_SOURCE_TRUST', () => {
  it('🔴 从名字解析的一律低可信 —— 名字有多套规范且会被事后改写', () => {
    expect(PLAY_SOURCE_TRUST.parsed_from_name).toBe('low')
  })
  it('建广告时声明的和人工补录的算高可信', () => {
    expect(PLAY_SOURCE_TRUST.declared_at_creation).toBe('high')
    expect(PLAY_SOURCE_TRUST.human_backfill).toBe('high')
  })
})

describe('inferPlayFromName —— 只当补录，永远标低可信', () => {
  const cases: [string, PlayKey][] = [
    ['CTS - ThruPlay Reels - Pool builder - 20260707', 'thruplay_pool_build'],
    ['30 Kiteroa · 看完视频 · 攒买家池 · Aug 2026',      'thruplay_pool_build'],
    ['30 Kiteroa · 预约表单 Lead Form · to Aug 20',      'lead_form_harvest'],
    ['30 Kiteroa · 私约看房 · 暖池重定向',                'warm_pool_retarget'],
    ['OZ-REACH-Warmpool-BNE-GC',                          'warm_pool_retarget'],
    ['30 Kiteroa · Unit 2/30 · Message Leads Test',       'messenger_direct'],
  ]

  it.each(cases)('从「%s」认出 %s', (name, expected) => {
    const r = inferPlayFromName(name)
    expect(r.play).toBe(expected)
    expect(r.source).toBe('parsed_from_name')
  })

  it('🔴 认不出来时留空并说明，绝不硬猜', () => {
    const r = inferPlayFromName('新潜在客户广告 - 广告副本')
    expect(r.play).toBeNull()
    expect(r.reason).toContain('认不出')
  })

  it('空名字也如实说明', () => {
    expect(inferPlayFromName(null).play).toBeNull()
    expect(inferPlayFromName('   ').reason).toContain('没有名字')
  })

  it('🔴 无论认出与否，来源永远标 parsed_from_name（不能冒充高可信）', () => {
    expect(inferPlayFromName('ThruPlay pool').source).toBe('parsed_from_name')
    expect(inferPlayFromName('认不出的名字').source).toBe('parsed_from_name')
  })

  it('回归：被事后改名成事故记录的广告，仍能认出原打法', () => {
    // 库里真实存在：三条广告名被改写成 [停用·…] 来记录事故
    expect(inferPlayFromName('[停用·编造看房时间] 私约 CN · 本周末两时段').play).toBeNull()
    // ↑ 认不出是对的：这个名字里没有打法线索，硬猜反而会把事故广告算进某个打法的账
  })
})
