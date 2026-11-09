import { describe, it, expect } from 'vitest'
import { verifyPlaceProvenance, classifyRenderMode } from './shot-guards'

// 测试样本 = 2026-09-04 CTS 圣诞 reel 真出过的错 + 子牙/魏征复审挖出的反例。
// 这两道闸的存在意义就是拦住这些。

describe('verifyPlaceProvenance', () => {
  it('🔴 拦住"搜索词命中但内容不符"——那座冒充西安的临水塔', () => {
    const r = verifyPlaceProvenance('a tall pagoda illuminated at night', ['xian', "xi'an", 'shaanxi'])
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PLACE_NOT_NAMED')
  })

  it('🔴 拦住爱丁堡圣诞市集冒充中国', () => {
    expect(verifyPlaceProvenance('christmas in edinburgh', ['china', 'shanghai', 'beijing']).ok).toBe(false)
  })

  it('🔴 复审反例：Chinatown 不能被 china 子串放行（悉尼/旧金山/奥克兰唐人街）', () => {
    expect(verifyPlaceProvenance('San Francisco Chinatown streetscape', ['china']).ok).toBe(false)
    expect(verifyPlaceProvenance('Sydney Chinatown lunar new year', ['china', 'shanghai']).ok).toBe(false)
    expect(verifyPlaceProvenance('London Chinatown gate on Wardour Street', ['china']).ok).toBe(false)
  })

  it('🔴 复审反例：fine china（瓷器）作独立词也不该当"中国"——用城市名才对', () => {
    // 同音多义靠关键词区分不了国名，但用具体城市名就没这歧义
    expect(verifyPlaceProvenance('a fine china teacup on a table', ['shanghai', 'beijing']).ok).toBe(false)
  })

  it('放行来源确实指名地点的图（真西安街景，带撇号）', () => {
    const r = verifyPlaceProvenance("busy city street with xi'an bell tower in distance", ['xian', "xi'an"])
    expect(r.ok).toBe(true)
    expect(r.code).toBe('PLACE_NAMED')
  })

  it('放行兵马俑（来源明确写了 terracotta）', () => {
    const r = verifyPlaceProvenance(
      'terracotta warriors army of emperor qin shi huang, the first emperor of china',
      ['terracotta', 'xian'],
    )
    expect(r.ok).toBe(true)
    expect(r.matchedKeyword).toBe('terracotta')
  })

  it('复审修正：中文来源 + 中文关键词也能命中（西安钟楼夜景）', () => {
    expect(verifyPlaceProvenance('西安钟楼夜景灯光', ['西安']).ok).toBe(true)
  })

  it('来源无任何文字 → 判不合格（宁可不打地名）', () => {
    const r = verifyPlaceProvenance('   ', ['shanghai'])
    expect(r.ok).toBe(false)
    expect(r.code).toBe('NO_METADATA')
  })

  it('大小写 / 首尾空格不影响匹配', () => {
    expect(verifyPlaceProvenance('Night of SHANGHAI from the Bund', ['  shanghai  ']).ok).toBe(true)
  })
})

describe('classifyRenderMode', () => {
  it('🔴 兵马俑（密集人脸）→ 真实像素', () => {
    const r = classifyRenderMode('rows of terracotta warriors, each with a unique face')
    expect(r.mode).toBe('real_pixel')
    expect(r.riskSignals).toEqual(expect.arrayContaining(['warrior']))
  })

  it('🔴 西安街头（招牌+真人）→ 真实像素', () => {
    expect(classifyRenderMode('busy night street food market with shopfront signs and pedestrians').mode).toBe('real_pixel')
  })

  it('🔴 重庆楼体中文字 → 真实像素', () => {
    expect(classifyRenderMode('city skyline tower with chinese characters 重庆你好 lit on the building').mode).toBe('real_pixel')
  })

  it('🔴 复审反例：人物镜（不写 face/people 也要认出）→ 真实像素', () => {
    for (const desc of [
      'a woman smiling at the camera on the promenade',
      'a chef preparing hand-pulled noodles',
      'a happy family walking along the harbour',
      'a young girl holding a red lantern',
      'a vendor cooking dumplings at a stall',
      'a monk in orange robes at the temple gate',
    ]) {
      expect(classifyRenderMode(desc).mode, desc).toBe('real_pixel')
    }
  })

  it('🔴 复审反例：文字复数（billboards/menus/posters/banners）→ 真实像素', () => {
    for (const desc of [
      'giant billboards over the plaza at night',
      'movie posters plastered on the wall',
      'restaurant menus displayed by the entrance',
      'festival banners strung across the lane',
    ]) {
      expect(classifyRenderMode(desc).mode, desc).toBe('real_pixel')
    }
  })

  it('长城空镜 / 水乡 / 夜景天际线（无文字人脸）→ 可 i2v', () => {
    for (const desc of [
      'misty great wall of china running over a snow-covered ridge',
      'traditional chinese water town canal with wooden boats and lanterns',
      'illuminated riverfront skyline at night, lights on the water',
    ]) {
      expect(classifyRenderMode(desc).mode, desc).toBe('i2v')
    }
  })

  it('复审反例：中文单字不再误伤（无人机→人、十字→字）→ 保持 i2v', () => {
    expect(classifyRenderMode('无人机航拍长城日出').mode).toBe('i2v')
    expect(classifyRenderMode('十字路口的数字时钟远景').mode).toBe('i2v')
  })

  it('不被 design/shopping 之类假朋友误伤（词边界匹配）', () => {
    const r = classifyRenderMode('a beautifully designed modern building, shopping district skyline')
    expect(r.riskSignals).not.toEqual(expect.arrayContaining(['sign']))
    expect(r.mode).toBe('i2v')
  })
})
