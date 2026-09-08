/**
 * 画册默认内容由行程单长出来 —— 顾问打开就是一份能看的稿子，活是「改」不是「写」。
 *
 * 这里的用例大多来自库里真实的报价单：编出来的行程太规整，
 * 遮住的恰恰是真实数据里那些会出事的写法。
 */

import { describe, it, expect } from 'vitest'
import { createBrochureFromItinerary } from '../brochure-seed'
import { HERO_PREFIX, isBrochureCard, type BrochureBlock } from '../brochure-types'

/** 取卡片的图；不是景点卡片就是用例写错了 */
function img(block: BrochureBlock): string {
  if (!isBrochureCard(block)) throw new Error('expected an image card')
  return block.image
}
import { createBlankItinerary, type TailorMadeDay, type TailorMadeItinerary } from '../types'

function build(route: string[], days: Partial<TailorMadeDay>[]): TailorMadeItinerary {
  const it = createBlankItinerary('CTS-2026-0024')
  it.trip.title = 'China Signature — China Panorama'
  it.trip.route = route
  it.trip.summary = 'The ultimate 27-day China experience.'
  it.days = days.map((d, i) => ({
    day: d.day ?? i + 1,
    date: '', weekday: '',
    route: d.route ?? '',
    body: d.body ?? '',
    travel: d.travel ?? '',
    accommodation: d.accommodation ?? '',
    meals: '',
  }))
  return it
}

describe('createBrochureFromItinerary', () => {
  /**
   * CTS-2026-0024 真实数据：第 1 天写的是 "Auckland → Shanghai"，
   * 而上海是这条 12 城路线的**最后**一站。
   *
   * 「提到哪个城市就归哪个」会把这天归给上海，上海那页于是标成「第 01–27 天」——
   * 一份发给付费客户的文件上，这种错读起来还挺合理，最难被发现。
   */
  it('转机途经的城市不算到站', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing', "Xi'an", 'Shanghai'], [
        { day: 1, route: 'Auckland → Shanghai', body: 'Depart Auckland.' },
        { day: 2, route: 'Shanghai → Beijing', body: 'Fly on to Beijing.' },
        { day: 3, route: 'Beijing', body: 'The Great Wall at Mutianyu, a long day on the wall.' },
        { day: 4, route: "Beijing → Xi'an", body: 'High-speed train south.' },
        { day: 5, route: "Xi'an", body: 'The Terracotta Warriors.' },
        { day: 6, route: "Xi'an → Shanghai", body: 'Fly to Shanghai.' },
        { day: 7, route: 'Shanghai', body: 'The Bund and Yu Garden.' },
      ])
    )

    const [beijing, xian, shanghai] = brochure.cities
    expect(beijing.days).toBe('DAYS 02 – 03')
    expect(xian.days).toBe('DAYS 04 – 05')
    // 关键：上海是第 06–07 天，不是第 01–07 天
    expect(shanghai.days).toBe('DAYS 06 – 07')
  })

  it('每个城市正文最长的那天升为整版大图页，其余成卡片', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing'], [
        { day: 1, route: 'Beijing', body: 'Short.' },
        { day: 2, route: 'Beijing', body: 'A much longer description of the Great Wall at Mutianyu.' },
        { day: 3, route: 'Beijing', body: 'Middle length one about the Forbidden City.' },
      ])
    )

    const beijing = brochure.cities[0]
    expect(beijing.hero.body).toContain('Mutianyu')
    expect(beijing.blocks).toHaveLength(2)
    expect(beijing.blocks.map((b) => b.body)).not.toContain(beijing.hero.body)
  })

  it('正文为空的天不生成空卡片', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing'], [
        { day: 1, route: 'Beijing', body: 'Something to say.' },
        { day: 2, route: 'Beijing', body: '' },
        { day: 3, route: 'Beijing', body: '   ' },
      ])
    )
    expect(brochure.cities[0].blocks).toHaveLength(0)
  })

  /**
   * 第一版把卡片图一律留空，打开是十几张空灰块 —— 顾问的第一反应是「这东西坏了」，
   * 不是「我该配图了」。PM 2026-08-30 在后台截图反馈。
   */
  it('卡片按当天写了什么配图，图库里有的地标优先', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing'], [
        { day: 1, route: 'Beijing', body: 'Arrive and settle in, then a first look around the city.' },
        { day: 2, route: 'Beijing', body: 'Today head out to the magnificent Great Wall at Mutianyu.' },
        { day: 3, route: 'Beijing', body: "Tian'anmen Square, then the Forbidden City." },
      ])
    )
    const beijing = brochure.cities[0]
    // 长城那天正文最长，升为整版大图 —— 大图也按内容配，不退回泛泛的北京城景
    expect(beijing.hero.image).toBe(`${HERO_PREFIX}great-wall`)
    // 抵达日没写到具体地标，落回本城通用照；故宫那天配故宫
    expect(img(beijing.blocks[0])).toBe(`${HERO_PREFIX}beijing`)
    expect(img(beijing.blocks[1])).toBe(`${HERO_PREFIX}forbidden-city`)
  })

  /**
   * 中转日「Chongqing → Shanghai」的正文里有 "Transfer to Chongqing airport"。
   * 按正文匹配会给**上海**那页配一张重庆的照片 —— 真实数据 CTS-2026-0026 上发生过。
   */
  it('不拿别的城市的照片配图，宁可用本城通用照', () => {
    const brochure = createBrochureFromItinerary(
      build(['Chongqing', 'Shanghai'], [
        { day: 1, route: 'Chongqing', body: 'Ciqikou and Hongyadong along the river.' },
        { day: 2, route: 'Chongqing → Shanghai', body: 'Transfer to Chongqing airport for your flight to Shanghai.' },
        { day: 3, route: 'Shanghai', body: 'Yu Garden and the Oriental Pearl Tower.' },
      ])
    )
    const shanghai = brochure.cities[1]
    // 这张卡片在上海那一页，正文提到重庆机场 —— 必须是上海的图
    expect(shanghai.blocks.map(img)).not.toContain(`${HERO_PREFIX}chongqing`)
    expect(shanghai.blocks.every((b) => img(b) === `${HERO_PREFIX}shanghai`)).toBe(true)
  })

  /**
   * 一度为了避免跟大图撞图而把卡片留空，结果 11 张空了 8 张 ——
   * 为了躲一个小瑕疵制造了一个大问题。
   */
  it('允许跟本城大图重复，不为了躲撞图把卡片留空', () => {
    const brochure = createBrochureFromItinerary(
      build(['Chongqing'], [
        { day: 1, route: 'Chongqing', body: 'A long first day taking in the river and the city from above.' },
        { day: 2, route: 'Chongqing', body: 'A quieter second day.' },
      ])
    )
    const city = brochure.cities[0]
    expect(city.hero.image).toBe(`${HERO_PREFIX}chongqing`)
    expect(img(city.blocks[0])).toBe(`${HERO_PREFIX}chongqing`)
  })

  it('城市本身就不在图库里时才真的留空，不拿别的城市的照片凑', () => {
    // 宜昌（长江三峡）图库里没有 —— 配一张别处的照片，客人一眼看出是套模板
    const brochure = createBrochureFromItinerary(
      build(['Yichang'], [
        { day: 1, route: 'Yichang', body: 'Board your Yangtze River cruise this afternoon.' },
        { day: 2, route: 'Yichang', body: 'A day on the river.' },
      ])
    )
    expect(brochure.cities[0].hero.image).toBe('')
    expect(img(brochure.cities[0].blocks[0])).toBe('')
  })

  it('大图按城市自动选，存的是名字不是几百 KB 的图', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing', 'Chongqing'], [
        { day: 1, route: 'Beijing', body: 'x' },
        { day: 2, route: 'Chongqing', body: 'y' },
      ])
    )
    expect(brochure.cities[0].hero.image).toBe(`${HERO_PREFIX}beijing`)
    expect(brochure.cities[1].hero.image).toBe(`${HERO_PREFIX}chongqing`)
    expect(brochure.cover.image.startsWith(HERO_PREFIX)).toBe(true)
    // 整份画册应该还是很小的一段 JSON
    expect(JSON.stringify(brochure).length).toBeLessThan(20_000)
  })

  it('照抄行程单原文，不替顾问编造介绍', () => {
    const brochure = createBrochureFromItinerary(
      build(['Beijing'], [{ day: 1, route: 'Beijing', body: 'Visit Tian\'anmen Square.' }])
    )
    expect(brochure.overview.intro).toBe('The ultimate 27-day China experience.')
    expect(brochure.cities[0].hero.body).toBe("Visit Tian'anmen Square.")
    // 行程单没写的一律留空，不能出现系统脑补的句子
    expect(brochure.overview.note.title).toBe('')
    expect(brochure.overview.note.body).toBe('')
  })

  it('行程单一天都还没填时不炸，给出空城市页', () => {
    const brochure = createBrochureFromItinerary(build(['Beijing', "Xi'an"], []))
    expect(brochure.cities).toHaveLength(2)
    expect(brochure.cities[0].blocks).toEqual([])
    expect(brochure.cities[0].days).toBe('')
  })
})

/**
 * hero.ts 拆成「选图规则」和「读文件」两半之后，读文件那半仍要能独立跑通。
 *
 * 这条用例是被一个真 bug 逼出来的：拆分时 pickHeroName 只被 re-export、
 * 没 import 进作用域，`export {x} from` 不会在本模块建立绑定。
 * 单测没调用过 heroForTrip，所以测试全绿、构建也过，只有 type-check 报了出来。
 */
describe('hero 拆分后仍然可用', () => {
  it('heroForTrip 能选图并读出图来', async () => {
    const { heroForTrip } = await import('../hero')
    const uri = await heroForTrip({ title: 'China Icons', route: ['Beijing', 'Shanghai'] })
    expect(uri).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('图库里没有的名字回落到兜底图，不抛错', async () => {
    const { loadHeroDataUri } = await import('../hero')
    expect(await loadHeroDataUri('../../etc/passwd')).toMatch(/^data:image\/jpeg;base64,/)
  })
})
