import { describe, it, expect } from 'vitest'
import {
  consolidateSeeds,
  ideasToSeeds,
  DEFAULT_FILTER,
} from '../seed-expansion'
import type { SeedKeyword } from '../seed-expansion'
import type { LabsKeyword } from '@/lib/dataforseo/labs'

/** 造一条 keyword_ideas 返回项。字段名照 LabsKeyword。 */
function idea(keyword: string, search_volume: number | null, cpc = 0.3): LabsKeyword {
  return {
    keyword,
    search_volume,
    keyword_difficulty: 20,
    cpc,
    competition: 0.5,
    intent: 'commercial',
    position: null,
  }
}

describe('ideasToSeeds', () => {
  it('保留品类词，带上方向与锚点溯源', () => {
    const seeds = ideasToSeeds('phone_tech', 'portable blender', [
      idea('portable blender usb', 480),
      idea('mini blender', 320),
    ])
    expect(seeds).toHaveLength(2)
    expect(seeds[0]).toMatchObject({
      keyword: 'portable blender usb',
      direction: 'phone_tech',
      anchor: 'portable blender',
      searchVolumeNz: 480,
      cpcUsd: 0.3,
    })
  })

  it('🔴 含品牌词一律剔除 —— 我们做白牌品类，不卖别人的品牌', () => {
    const seeds = ideasToSeeds('phone_tech', 'portable blender', [
      idea('ninja portable blender', 900),
      idea('nutribullet blender', 700),
      idea('portable blender rechargeable', 260),
    ])
    expect(seeds.map((s) => s.keyword)).toEqual(['portable blender rechargeable'])
  })

  it('🔴 问句不是品类词，剔除', () => {
    const seeds = ideasToSeeds('pet', 'slow feeder dog bowl', [
      idea('how to use slow feeder dog bowl', 300),
      idea('are slow feeder bowls good', 200),
      idea('slow feeder dog bowl large', 150),
    ])
    expect(seeds.map((s) => s.keyword)).toEqual(['slow feeder dog bowl large'])
  })

  it('🔴 搜索量取不到或低于下限 → 剔除，不当 0 也不放行', () => {
    const seeds = ideasToSeeds('pet', 'pet water fountain', [
      idea('pet water fountain', 900),
      idea('pet water fountain ceramic', 40),   // < 50 门槛
      idea('pet water fountain steel', null),    // 取不到
    ])
    expect(seeds.map((s) => s.keyword)).toEqual(['pet water fountain'])
  })

  it('🔴 搜索量过高（红海）→ 剔除。高搜索量不是好机会，是轮不到我们', () => {
    const seeds = ideasToSeeds('auto_accessories', 'car vacuum cleaner cordless', [
      idea('vacuum cleaner', 12100),      // 成熟红海，> 3000 上限
      idea('car air compressor', 880),    // 套利窗口内
    ])
    expect(seeds.map((s) => s.keyword)).toEqual(['car air compressor'])
  })

  it('🔴 耗材 / 大类泛化词根剔除 —— 电池/灯泡/园艺不是耐用套利品', () => {
    const seeds = ideasToSeeds('auto_accessories', 'jump starter power bank', [
      idea('aa battery', 2900),
      idea('lithium battery', 1900),
      idea('led lights', 2400),
      idea('water garden', 600),
      idea('car air compressor', 880),   // 唯一该留的
    ])
    expect(seeds.map((s) => s.keyword)).toEqual(['car air compressor'])
  })

  it('🔴 整词错品类剔除：排气扇 / 集雨桶（50 词实测漏网的两类）', () => {
    const seeds = ideasToSeeds('pet', 'pet water fountain', [
      idea('bathroom exhaust fan', 900),
      idea('water trough', 880),
      idea('cat water fountain', 480),   // 唯一该留的
    ])
    expect(seeds.map((s) => s.keyword)).toEqual(['cat water fountain'])
  })

  it('🔴 零售商名与漏网品牌剔除（PB Tech / Bulbs Direct / eufy）', () => {
    const seeds = ideasToSeeds('phone_tech', 'wireless charger', [
      idea('pb tech power bank', 590),
      idea('bulbs direct nz', 4400),
      idea('eufy camera', 900),
      idea('portable charger', 480),   // 唯一该留的
    ])
    expect(seeds.map((s) => s.keyword)).toEqual(['portable charger'])
  })

  it('词数超上限（长尾规格）剔除', () => {
    const seeds = ideasToSeeds('home_gadgets', 'mini humidifier', [
      idea('mini humidifier', 800),
      idea('mini humidifier for bedroom with night light usb', 120), // 8 词 > 5
    ])
    expect(seeds.map((s) => s.keyword)).toEqual(['mini humidifier'])
  })

  it('门槛可调 —— 传入更低的下限会放行更多', () => {
    const ideas = [idea('dash cam', 900), idea('dash cam wifi', 30)]
    expect(ideasToSeeds('auto_accessories', 'dash cam', ideas, DEFAULT_FILTER)).toHaveLength(1)
    expect(ideasToSeeds('auto_accessories', 'dash cam', ideas,
      { minSearchVolume: 20, maxSearchVolume: 3000, maxWords: 5 })).toHaveLength(2)
  })
})

describe('consolidateSeeds', () => {
  function seed(
    keyword: string,
    direction: SeedKeyword['direction'],
    searchVolumeNz: number,
    anchor = 'x',
  ): SeedKeyword {
    return { keyword, direction, anchor, searchVolumeNz, cpcUsd: 0.3 }
  }

  it('🔴 同一个词从两个锚点长出来 → 只留搜索量高的那条', () => {
    const out = consolidateSeeds([
      seed('car air compressor', 'auto_accessories', 300, 'tyre inflator'),
      seed('car air compressor', 'auto_accessories', 500, 'jump starter'),
    ], 25)
    expect(out).toHaveLength(1)
    expect(out[0].searchVolumeNz).toBe(500)
    expect(out[0].anchor).toBe('jump starter')
  })

  it('每个方向按搜索量取 top N，方向之间互不挤占', () => {
    const out = consolidateSeeds([
      seed('a', 'pet', 100), seed('b', 'pet', 300), seed('c', 'pet', 200),
      seed('d', 'phone_tech', 500),
    ], 2)
    // pet 取前 2（300, 200），phone_tech 只有 1 个全留。
    const pet = out.filter((s) => s.direction === 'pet').map((s) => s.searchVolumeNz)
    expect(pet).toEqual([300, 200])
    expect(out.filter((s) => s.direction === 'phone_tech')).toHaveLength(1)
  })

  it('去重按小写，大小写不同不算两个词', () => {
    const out = consolidateSeeds([
      seed('Dash Cam', 'auto_accessories', 200),
      seed('dash cam', 'auto_accessories', 100),
    ], 25)
    expect(out).toHaveLength(1)
    expect(out[0].searchVolumeNz).toBe(200)
  })

  it('空输入 → 空输出，不抛错', () => {
    expect(consolidateSeeds([], 25)).toEqual([])
  })
})
