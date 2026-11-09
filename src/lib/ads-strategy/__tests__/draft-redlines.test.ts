/**
 * 广告草案的禁用词：比对口径 + 「没加载」和「查过没有」必须分得开。
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  foldForRedline,
  findRedlineHits,
  unusableRedlinePhrases,
  checkDraftRedlines,
  loadDraftRedlines,
} from '../draft-redlines'
import type { AdDraft } from '../ad-draft'

// 测试用的占位短语，不是任何真实客户的红线。
const PHRASE = 'founded in 1900'

function draftWith(over: Partial<AdDraft> = {}, text = 'Join our tour'): AdDraft {
  return {
    kind: 'messenger_conversation',
    clientId: 'c1', campaignName: 'c', adSetName: 'a', dailyBudget: 10, durationDays: 7,
    geoCountries: ['NZ'], pageId: 'p',
    creatives: [{ name: 'A', primaryText: text, headline: 'Hello', videoId: 'v', thumbnailImageHash: 'h', language: 'en' }],
    ...over,
  }
}

describe('foldForRedline', () => {
  it('全角数字字母折成半角', () => {
    expect(foldForRedline('１９００')).toBe('1900')
    expect(foldForRedline('ＡＢＣ')).toBe('ABC')
  })

  it('零宽字符和软连字符去掉', () => {
    expect(foldForRedline('in​1900')).toBe('in1900')
    expect(foldForRedline('a­b﻿c⁠d')).toBe('abcd')
  })

  it('标点当空格，连续空白折成一个', () => {
    expect(foldForRedline('since-1900')).toBe('since 1900')
    expect(foldForRedline('Auckland,  since 1900!')).toBe('Auckland since 1900 ')
  })
})

describe('findRedlineHits', () => {
  it('普通命中，大小写不敏感，返回的是调用方传进来的原短语', () => {
    expect(findRedlineHits(['We were FOUNDED IN 1900 you know'], [PHRASE])).toEqual([PHRASE])
  })

  it('没命中 → 空', () => {
    expect(findRedlineHits(['Join our tour'], [PHRASE])).toEqual([])
  })

  it('全角数字绕不过', () => {
    expect(findRedlineHits(['founded in １９００'], [PHRASE])).toEqual([PHRASE])
  })

  it('夹零宽字符绕不过', () => {
    expect(findRedlineHits(['founded​ in 19‍00'], [PHRASE])).toEqual([PHRASE])
  })

  it('标点和连字符变体绕不过', () => {
    expect(findRedlineHits(['Founded, in-1900!'], [PHRASE])).toEqual([PHRASE])
  })

  it('短语本身存的是全角 / 带标点，也能匹配普通文字', () => {
    expect(findRedlineHits(['founded in 1900'], ['Ｆounded in １９００'])).toEqual(['Ｆounded in １９００'])
    expect(findRedlineHits(['founded in 1900'], ['founded, in 1900'])).toEqual(['founded, in 1900'])
  })

  it('空白 / 单字符 / 全标点的短语不参与（空串会让 includes 恒真，每条广告都命中）', () => {
    expect(findRedlineHits(['anything at all'], ['', '   ', 'a', '!!!', '—'])).toEqual([])
  })

  it('null / undefined 文案忽略', () => {
    expect(findRedlineHits([null, undefined, PHRASE], [PHRASE])).toEqual([PHRASE])
  })

  it('短英文词按整词比：「ai」不误杀 email / said / available', () => {
    expect(findRedlineHits(['Send an email, she said it is available'], ['AI'])).toEqual([])
    expect(findRedlineHits(['We use AI to plan routes'], ['AI'])).toEqual(['AI'])
    expect(findRedlineHits(['ai, again'], ['ai'])).toEqual(['ai'])
  })

  it('带符号的短语折叠后也不会命中无关的词：AT&T 不命中 what time', () => {
    expect(findRedlineHits(['what time is it'], ['AT&T'])).toEqual([])
    expect(findRedlineHits(['call AT&T today'], ['AT&T'])).toEqual(['AT&T'])
  })

  it('整词匹配不能跨文案拼接：前一段结尾 + 后一段开头不算命中', () => {
    expect(findRedlineHits(['we love the new', 'tour dates'], ['new tour'])).toEqual([])
  })

  it('中文等没有空格分词的文字仍按子串比', () => {
    expect(findRedlineHits(['圣诞节特价团现在报名'], ['特价'])).toEqual(['特价'])
    expect(findRedlineHits(['圣诞节特价团现在报名'], ['特价团'])).toEqual(['特价团'])
  })

  it('已知挡不住的（写在这里是为了让人知道边界，不是为了通过）', () => {
    expect(findRedlineHits(['founded nineteen hundred years ago'], [PHRASE])).toEqual([])
  })
})

describe('unusableRedlinePhrases — 不静默忽略', () => {
  it('列出折叠后太短的条目；正常的不列', () => {
    expect(unusableRedlinePhrases(['', '  ', 'a', '!!!', 'real phrase', '特价'])).toEqual(['', '  ', 'a', '!!!'])
  })
})

describe('checkDraftRedlines — 没加载 和 查过没有 不能混', () => {
  it('私信类型 + 没加载(undefined) → 拒（fail-closed）', () => {
    const p = checkDraftRedlines(draftWith(), undefined)
    expect(p.map((x) => x.field)).toEqual(['brandRedlines'])
  })

  it('私信类型 + 空数组(客户没配) → 放行', () => {
    expect(checkDraftRedlines(draftWith(), [])).toEqual([])
  })

  it('其它类型 + 没加载 → 不查（沿用旧行为）', () => {
    expect(checkDraftRedlines(draftWith({ kind: 'lead_form' }), undefined)).toEqual([])
    expect(checkDraftRedlines(draftWith({ kind: 'video_thruplay' }), undefined)).toEqual([])
  })

  it('命中 → 拒，并报出命中的短语（所有类型都查）', () => {
    for (const kind of ['messenger_conversation', 'lead_form', 'video_thruplay'] as const) {
      const p = checkDraftRedlines(draftWith({ kind }, 'We are founded in 1900'), [PHRASE])
      expect(p, kind).toHaveLength(1)
      expect(p[0].message).toContain(PHRASE)
    }
  })

  it('标题和描述里的也查', () => {
    const d = draftWith()
    d.creatives[0].headline = 'Founded in 1900'
    expect(checkDraftRedlines(d, [PHRASE])).toHaveLength(1)
    d.creatives[0].headline = 'ok'
    d.creatives[0].description = 'founded in １９００'
    expect(checkDraftRedlines(d, [PHRASE])).toHaveLength(1)
  })

  it('creatives 形状不对不抛（undefined / 条目是 null / 数字 / 正文不是字符串）', () => {
    for (const creatives of [undefined, [null], [5], [{ name: 'A', primaryText: 5, headline: 'h' }]]) {
      expect(() => checkDraftRedlines(draftWith({ creatives: creatives as never }), [PHRASE])).not.toThrow()
    }
    // 好的条目照样被查，坏条目不拖累它
    const mixed = [null, { name: 'A', primaryText: 'founded in 1900', headline: 'h' }]
    expect(checkDraftRedlines(draftWith({ creatives: mixed as never }), [PHRASE])).toHaveLength(1)
  })
})

type Res = { data: unknown; error: unknown }
function fakeSb(client: Res, brief: Res): SupabaseClient {
  const chain = (res: Res) => {
    const o: Record<string, unknown> = {}
    o.select = () => o
    o.eq = () => o
    o.maybeSingle = async () => res
    return o
  }
  return { from: (t: string) => chain(t === 'clients' ? client : brief) } as unknown as SupabaseClient
}

describe('loadDraftRedlines', () => {
  it('三个来源合并；空白条目和非字符串丢掉', async () => {
    const sb = fakeSb(
      { data: { brand_redline_phrases: ['one phrase', '  ', 5] }, error: null },
      { data: { avoid_words: ['two phrase'], excluded_topics: ['three phrase', ''] }, error: null },
    )
    expect(await loadDraftRedlines(sb, 'c1')).toEqual(['one phrase', 'two phrase', 'three phrase'])
  })

  it('什么都没配 → 空数组（= 查过，没有），不是 null', async () => {
    const sb = fakeSb({ data: { brand_redline_phrases: null }, error: null }, { data: null, error: null })
    expect(await loadDraftRedlines(sb, 'c1')).toEqual([])
  })

  it('客户这一行读不到(data=null) → null，不能说「这个客户没配红线」', async () => {
    const sb = fakeSb({ data: null, error: null }, { data: null, error: null })
    expect(await loadDraftRedlines(sb, 'c1')).toBeNull()
  })

  it('字段被存成了字符串 / 对象而不是数组 → null（读不懂），不退化成空', async () => {
    for (const bad of ['a phrase, b phrase', { x: 1 }, 5]) {
      const a = fakeSb({ data: { brand_redline_phrases: bad }, error: null }, { data: null, error: null })
      expect(await loadDraftRedlines(a, 'c1'), `clients ${JSON.stringify(bad)}`).toBeNull()
      const b = fakeSb({ data: { brand_redline_phrases: [] }, error: null }, { data: { avoid_words: bad }, error: null })
      expect(await loadDraftRedlines(b, 'c1'), `avoid ${JSON.stringify(bad)}`).toBeNull()
      const c = fakeSb({ data: { brand_redline_phrases: [] }, error: null }, { data: { excluded_topics: bad }, error: null })
      expect(await loadDraftRedlines(c, 'c1'), `excluded ${JSON.stringify(bad)}`).toBeNull()
    }
  })

  it('这个客户没有生效的 brief（data=null）是正常的 → 只用客户表那一份', async () => {
    const sb = fakeSb({ data: { brand_redline_phrases: ['x phrase'] }, error: null }, { data: null, error: null })
    expect(await loadDraftRedlines(sb, 'c1')).toEqual(['x phrase'])
  })

  it('读客户表出错 → null（= 没读到），不是空数组', async () => {
    const sb = fakeSb({ data: null, error: { message: 'boom' } }, { data: null, error: null })
    expect(await loadDraftRedlines(sb, 'c1')).toBeNull()
  })

  it('读 brief 出错(例如同一客户多条生效记录让 maybeSingle 报错) → null，不静默变成空', async () => {
    const sb = fakeSb({ data: { brand_redline_phrases: ['x phrase'] }, error: null }, { data: null, error: { message: 'multiple rows' } })
    expect(await loadDraftRedlines(sb, 'c1')).toBeNull()
  })
})
