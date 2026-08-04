/**
 * 终端客户 / 同行 / 自己人。
 *
 * 这三类的跟进方式完全不同，分错的代价是真实的：
 *   · 把员工当客人 → 老板打开名单看到自己的同事（2026-08-04 就是这么被投诉的）
 *   · 把同行当散客 → 销售用「您考虑得怎么样了」去问一个每周订十次位的同行
 *   · 把散客当同行 → **最贵的一种**，他被移出主名单，从此没人跟进
 *
 * 最后一条决定了这里的取舍：**判据必须严格**，宁可漏标一个同行
 * （他还在主名单里，只是没有标记），也不要误标一个散客。
 */

import { describe, expect, it } from 'vitest'
import {
  contactKindOf,
  normaliseDomain,
  parseDomainList,
  readDomainRules,
  EMPTY_RULES,
  type DomainRules,
} from '../contact-kind'

const RULES: DomainRules = {
  own: ['ctstours.co.nz', 'chinatravel.co.nz'],
  trade: ['hot.co.nz', 'travelmanagers.co.nz', 'orbit.co.nz'],
}

describe('分成哪一类', () => {
  it('普通个人邮箱 → 终端客户', () => {
    expect(contactKindOf(['brett@gmail.com'], RULES)).toBe('retail')
  })

  it('同行域名 → 同行', () => {
    expect(contactKindOf(['pieta.mace@hot.co.nz'], RULES)).toBe('trade')
  })

  it('客户自己的域名 → 自己人', () => {
    expect(contactKindOf(['amy@ctstours.co.nz'], RULES)).toBe('staff')
  })

  /** PM 2026-08-04 确认 chinatravel.co.nz 是 CTS 的员工域名。 */
  it('关联公司的域名也算自己人', () => {
    expect(contactKindOf(['pa@chinatravel.co.nz'], RULES)).toBe('staff')
  })

  it('没有任何邮箱 → 当终端客户，不猜', () => {
    expect(contactKindOf([], RULES)).toBe('retail')
  })

  it('没配任何域名 → 全是终端客户', () => {
    expect(contactKindOf(['pieta.mace@hot.co.nz'], EMPTY_RULES)).toBe('retail')
  })
})

describe('一个人挂多个邮箱', () => {
  /** 同行的人也会用私人 Gmail 来问事 —— 用公司邮箱写过信，就是那家公司的人。 */
  it('公司邮箱 + 私人邮箱 → 按公司邮箱算', () => {
    expect(contactKindOf(['vicki@gmail.com', 'vicki.hyslop@travelmanagers.co.nz'], RULES)).toBe('trade')
  })

  /**
   * 员工优先于同行。CTS 和 chinatravel 是关联公司，两个域名都可能出现在
   * 同行名单上；说「这是自己人」更准确，也更该被排除。
   */
  it('同时命中自己人和同行 → 算自己人', () => {
    const rules: DomainRules = { own: ['chinatravel.co.nz'], trade: ['chinatravel.co.nz'] }
    expect(contactKindOf(['pa@chinatravel.co.nz'], rules)).toBe('staff')
  })
})

describe('子域名', () => {
  /** 大公司的分部经常挂子域名，漏掉等于这条规则只覆盖一半。 */
  it('mail.hot.co.nz 命中 hot.co.nz', () => {
    expect(contactKindOf(['x@mail.hot.co.nz'], RULES)).toBe('trade')
  })

  /**
   * **但不能拿 endsWith 硬判** —— 那样 `nothot.co.nz` 会命中 `hot.co.nz`，
   * 把一个完全不相干的公司误标成同行，而被误标的人会从主名单上消失。
   */
  it('nothot.co.nz 不命中 hot.co.nz', () => {
    expect(contactKindOf(['x@nothot.co.nz'], RULES)).toBe('retail')
  })

  it('hot.co.nz.evil.com 不命中 hot.co.nz', () => {
    expect(contactKindOf(['x@hot.co.nz.evil.com'], RULES)).toBe('retail')
  })
})

describe('人填进去的东西什么形状都有', () => {
  it.each([
    ['HOT.co.nz', 'hot.co.nz'],
    ['  hot.co.nz  ', 'hot.co.nz'],
    ['https://www.hot.co.nz/', 'hot.co.nz'],
    ['www.hot.co.nz', 'hot.co.nz'],
    ['someone@hot.co.nz', 'hot.co.nz'],
    ['hot.co.nz,', 'hot.co.nz'],
  ])('%s → %s', (raw, want) => {
    expect(normaliseDomain(raw)).toBe(want)
  })

  it('设置页里粘了个整邮箱也照样能用', () => {
    const rules: DomainRules = { own: [], trade: ['  Someone@HOT.co.nz '] }
    expect(contactKindOf(['pieta@hot.co.nz'], rules)).toBe('trade')
  })
})

describe('读配置：一个填错的配置不该让整页打不开', () => {
  it('正常读出两份清单', () => {
    expect(
      readDomainRules({ own_email_domains: ['ctstours.co.nz'], trade_domains: ['hot.co.nz'] }),
    ).toEqual({ own: ['ctstours.co.nz'], trade: ['hot.co.nz'] })
  })

  it.each([[null], [undefined], [{}], ['字符串'], [42], [[]]])('配置是 %s → 两份都空，不抛', (cfg) => {
    expect(readDomainRules(cfg)).toEqual({ own: [], trade: [] })
  })

  it('数组里混进非字符串 → 只留字符串', () => {
    expect(readDomainRules({ trade_domains: ['hot.co.nz', 42, null, { a: 1 }] }).trade).toEqual([
      'hot.co.nz',
    ])
  })

  it('重复的域名去重', () => {
    expect(readDomainRules({ trade_domains: ['hot.co.nz', 'HOT.co.nz', ' hot.co.nz '] }).trade).toEqual([
      'hot.co.nz',
    ])
  })

  it('空字符串和纯空格丢掉', () => {
    expect(readDomainRules({ own_email_domains: ['', '   ', 'ctstours.co.nz'] }).own).toEqual([
      'ctstours.co.nz',
    ])
  })
})

/**
 * 设置页那两个框是给人填的，人会填公司名、半截地址、一句话。
 *
 * **这种东西必须当场退回去。** 默默存下来的话它永远不会命中任何邮箱，
 * 而填的人以为自己已经把同行标好了 —— 那批人继续躺在散客名单里，
 * 谁也不知道为什么。这一类「看起来生效了其实没有」的错最难查。
 */
describe('设置页填进来的东西', () => {
  it('一行一个', () => {
    expect(parseDomainList('hot.co.nz\ntravelmanagers.co.nz').domains).toEqual([
      'hot.co.nz',
      'travelmanagers.co.nz',
    ])
  })

  it.each([
    ['逗号', 'hot.co.nz, travelmanagers.co.nz'],
    ['中文逗号', 'hot.co.nz，travelmanagers.co.nz'],
    ['分号', 'hot.co.nz; travelmanagers.co.nz'],
    ['空格', 'hot.co.nz travelmanagers.co.nz'],
  ])('%s 也能分开 —— 从表格里粘过来是什么样都能收', (_label, text) => {
    expect(parseDomainList(text).domains).toHaveLength(2)
  })

  it.each([
    ['整个邮箱粘进来', 'pieta@hot.co.nz', 'hot.co.nz'],
    ['带网址前缀', 'https://www.hot.co.nz/about', 'hot.co.nz'],
    ['大写和空格', '  HOT.CO.NZ  ', 'hot.co.nz'],
    ['末尾带标点', 'hot.co.nz,', 'hot.co.nz'],
  ])('%s → %s', (_label, raw, want) => {
    expect(parseDomainList(raw).domains).toEqual([want])
  })

  it('重复的只留一个', () => {
    expect(parseDomainList('hot.co.nz\nHOT.co.nz\nmail@hot.co.nz').domains).toEqual(['hot.co.nz'])
  })

  it.each([
    'House of Travel',
    'travelmanagers',
    '同行',
    '.co.nz',
    '192.168.1.1',
  ])('认不出是域名的原样退回：%s', (bad) => {
    const r = parseDomainList(bad)
    expect(r.domains).toEqual([])
    expect(r.rejected).toEqual([bad])
  })

  /** 几条填错不该让已经填对的十条一起丢掉。 */
  it('好的存下来，坏的单独说 —— 不因为几条错就整次拒绝', () => {
    const r = parseDomainList('hot.co.nz\nHouse of Travel\ntravelmanagers.co.nz')
    expect(r.domains).toEqual(['hot.co.nz', 'travelmanagers.co.nz'])
    expect(r.rejected).toEqual(['House of Travel'])
  })

  it('数组也收（存下来的清单直接回填）', () => {
    expect(parseDomainList(['hot.co.nz', 'orbit.co.nz']).domains).toHaveLength(2)
  })

  it.each([null, undefined, 42, {}])('不是文字也不是清单（%s）→ 空，不炸', (junk) => {
    expect(parseDomainList(junk).domains).toEqual([])
  })

  it('子域名本身也是合法的一条 —— 有人只想标一个分部', () => {
    expect(parseDomainList('auckland.hot.co.nz').domains).toEqual(['auckland.hot.co.nz'])
  })
})

/**
 * 空格拆不拆，取决于拆开之后是不是全都成立。
 *
 * 无条件拆 → `House of Travel` 变成「House、of、Travel 不是域名」，
 * 填的人看了只会更懵、还以为系统坏了。完全不拆 → 一行粘两个域名就全废。
 */
describe('一行里带空格', () => {
  it('全是域名 → 拆开', () => {
    expect(parseDomainList('hot.co.nz travelmanagers.co.nz').domains).toEqual([
      'hot.co.nz',
      'travelmanagers.co.nz',
    ])
  })

  it('公司名 → 整条退回，不拆成三段', () => {
    expect(parseDomainList('House of Travel').rejected).toEqual(['House of Travel'])
  })

  it('半是半不是 → 整条退回（拆一半更让人糊涂）', () => {
    const r = parseDomainList('House of Travel hot.co.nz')
    expect(r.rejected).toEqual(['House of Travel hot.co.nz'])
    expect(r.domains).toEqual([])
  })

  it('这一行填错不影响别的行', () => {
    const r = parseDomainList('hot.co.nz\nHouse of Travel\norbit.co.nz')
    expect(r.domains).toEqual(['hot.co.nz', 'orbit.co.nz'])
    expect(r.rejected).toEqual(['House of Travel'])
  })
})
