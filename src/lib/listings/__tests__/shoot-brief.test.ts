/**
 * 拍摄单的测试。
 *
 * 守两条：
 *   1. **镜头从房源事实推，不是套一张固定清单** —— 公寓不写后院，
 *      地皮不写客厅，没写房型就不出卧室那几条
 *   2. **只写「怎么拍」，不写「这房子有多好」** —— 铁律 8，不凭空注入客户业务数据
 */
import { describe, it, expect } from 'vitest'
import {
  buildShootBrief,
  renderShootBrief,
  normalisePropertyKind,
  type ShootListingFacts,
} from '../shoot-brief'

const HOUSE: ShootListingFacts = {
  address: '9-11 Schnapper Rock Road',
  suburb: 'Schnapper Rock',
  bedrooms: 3,
  propertyType: 'House',
}

const shotText = (f: ShootListingFacts) =>
  buildShootBrief(f).shots.map((s) => `${s.what} ${s.how}`).join(' | ')

describe('normalisePropertyKind', () => {
  it.each([
    ['House', 'house'], ['独立屋', 'house'],
    ['Apartment', 'apartment'], ['Unit', 'apartment'], ['公寓', 'apartment'],
    ['Townhouse', 'townhouse'], ['Terrace', 'townhouse'],
    ['Section', 'section'], ['地皮', 'section'],
  ])('「%s」→ %s', (raw, want) => {
    expect(normalisePropertyKind(raw)).toBe(want)
  })

  it('认不出的一律 unknown，不猜', () => {
    expect(normalisePropertyKind('Lifestyle Block')).toBe('unknown')
    expect(normalisePropertyKind(null)).toBe('unknown')
    expect(normalisePropertyKind('')).toBe('unknown')
  })
})

describe('镜头按房源事实推，不套固定清单', () => {
  it('独立屋 → 有后院那一条', () => {
    expect(shotText(HOUSE)).toContain('后院')
  })

  it('🔴 公寓 → 不写后院（对着不存在的东西发指令，整张单子就不可信了）', () => {
    expect(shotText({ ...HOUSE, propertyType: 'Apartment' })).not.toContain('后院')
  })

  it('🔴 房型不确定 → 也不写后院（不假设有院子）', () => {
    expect(shotText({ ...HOUSE, propertyType: null })).not.toContain('后院')
    expect(shotText({ ...HOUSE, propertyType: 'Lifestyle Block' })).not.toContain('后院')
  })

  it('🔴 地皮 → 整套换成室外镜头，不出现客厅/主卧/厨房', () => {
    const t = shotText({ ...HOUSE, propertyType: 'Section', bedrooms: null })
    expect(t).not.toContain('客厅')
    expect(t).not.toContain('主卧')
    expect(t).not.toContain('厨房')
    expect(t).toContain('整块地')
  })

  it('没写房间数 → 不出卧室镜头（不编「主卧」出来）', () => {
    const t = shotText({ ...HOUSE, bedrooms: null })
    expect(t).not.toContain('主卧')
  })
  it('房间数 0 也一样不出', () => {
    expect(shotText({ ...HOUSE, bedrooms: 0 })).not.toContain('主卧')
  })

  it('1-2 房只拍主卧，不拍次卧', () => {
    expect(shotText({ ...HOUSE, bedrooms: 2 })).not.toContain('次卧')
  })

  it('3 房以上才加一条次卧，且**只加一条** —— 逐间拍是流水账', () => {
    const shots = buildShootBrief({ ...HOUSE, bedrooms: 6 }).shots
    expect(shots.filter((s) => s.what.includes('次卧'))).toHaveLength(1)
  })

  it('次卧那条会说清是从几间里挑', () => {
    expect(shotText({ ...HOUSE, bedrooms: 5 })).toContain('5 间')
  })
})

describe('真人出镜那一条', () => {
  it('永远在最后一条', () => {
    for (const t of ['House', 'Apartment', 'Section', null]) {
      const shots = buildShootBrief({ ...HOUSE, propertyType: t }).shots
      expect(shots[shots.length - 1].what).toContain('你自己站在门口')
    }
  })

  it('🔴 永远不能标成可省 —— 卖家向内容唯一真正的差异点就是「人」', () => {
    const last = buildShootBrief(HOUSE).shots.slice(-1)[0]
    expect(last.optional).toBe(false)
  })

  it('🔴 只留白让他自己说，不替他编一句关于这套房的话', () => {
    const last = buildShootBrief(HOUSE).shots.slice(-1)[0]
    expect(last.how).toContain('说你自己的话')
    // 不许出现替客户写好的台词
    expect(`${last.what} ${last.how}`).not.toMatch(/「.*」|"[^"]{8,}"/)
  })
})

describe('只写怎么拍，不写这房子有多好（铁律 8）', () => {
  it('整张单子里不出现对房子的形容', () => {
    const b = buildShootBrief(HOUSE)
    const all = [b.intro, ...b.shots.map((s) => `${s.what}${s.how}`), ...b.rules].join(' ')
    for (const word of ['宽敞', '豪华', '稀缺', '难得的地段', '采光极佳', '超值', '优质']) {
      expect(all, `不该出现「${word}」`).not.toContain(word)
    }
  })

  it('不出现价格、面积、学区这类会说错的事实', () => {
    const b = buildShootBrief(HOUSE)
    const all = JSON.stringify(b)
    expect(all).not.toMatch(/\$|学区|平方|㎡|万/)
  })

  it('标题只用地址和区，不加评价', () => {
    expect(buildShootBrief(HOUSE).title).toBe('9-11 Schnapper Rock Road，Schnapper Rock')
  })
})

describe('renderShootBrief — 能直接粘进微信', () => {
  it('带上传链接时把链接放最后', () => {
    const txt = renderShootBrief(buildShootBrief(HOUSE), 'https://x/upload/abc')
    expect(txt.trimEnd().endsWith('https://x/upload/abc')).toBe(true)
    expect(txt).toContain('只属于这套房')
  })

  it('没有链接就不出现那一段（不给一句空承诺）', () => {
    const txt = renderShootBrief(buildShootBrief(HOUSE), null)
    expect(txt).not.toContain('拍完传这里')
  })

  it('纯文本里不留 markdown 星号（微信里会原样显示成 **）', () => {
    expect(renderShootBrief(buildShootBrief(HOUSE))).not.toContain('**')
  })

  it('每条镜头都带序号和时长', () => {
    const txt = renderShootBrief(buildShootBrief(HOUSE))
    expect(txt).toMatch(/^1\. .+（.+秒）/m)
  })

  it('可省的那几条标出来 —— 现场时间不够时知道先砍哪个', () => {
    expect(renderShootBrief(buildShootBrief(HOUSE))).toContain('［可省］')
  })
})
