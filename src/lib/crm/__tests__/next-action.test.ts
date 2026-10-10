import { describe, it, expect } from 'vitest'
import { SEGMENT_META, type Segment, type SegmentResult } from '../segments'
import {
  INTENT_BOOST_SUFFIX,
  INTENT_LEVELS,
  LIST_META,
  VERB_LABEL,
  compareNextAction,
  listOf,
  nextActionFor,
  verbOf,
  type IntentLevel,
} from '../next-action'

function seg(segment: Segment, over: Partial<SegmentResult> = {}): SegmentResult {
  return {
    segment,
    temperature: SEGMENT_META[segment].temperature,
    priority: SEGMENT_META[segment].priority,
    reason: `reason-${segment}`,
    suggestedChannel: 'phone',
    lastTouchAt: '2026-09-01T00:00:00.000Z',
    dueAt: null,
    ...over,
  } as SegmentResult
}

const ALL_SEGMENTS = Object.keys(SEGMENT_META) as Segment[]
const ALL_INTENTS: Array<IntentLevel | null> = [...INTENT_LEVELS, null]

describe('listOf', () => {
  it.each(ALL_SEGMENTS.flatMap((s) => ALL_INTENTS.map((i) => [s, i] as const)))(
    '%s × %s 一定落在 hot 或 cold',
    (segment, intent) => {
      const list = listOf(segment, intent)
      expect(list === 'hot' || list === 'cold').toBe(true)
    },
  )

  it('每个 (分段 × 意向) 组合都恰好进一张名单，总数对得上', () => {
    let hot = 0
    let cold = 0
    for (const segment of ALL_SEGMENTS) {
      for (const intent of ALL_INTENTS) {
        if (listOf(segment, intent) === 'hot') hot++
        else cold++
      }
    }
    expect(hot + cold).toBe(ALL_SEGMENTS.length * ALL_INTENTS.length)
  })

  it('唯一的抬升：聊过一轮就断了 + 高意向 → hot', () => {
    expect(listOf('stale_conversation', 'high')).toBe('hot')
  })

  it('medium / low / unknown / null 都不抬升，跟基础名单一致', () => {
    for (const intent of ['medium', 'low', 'unknown', null] as const) {
      expect(listOf('stale_conversation', intent)).toBe('cold')
    }
  })

  it('意向低不许把本来在 hot 的人压下去', () => {
    const hotSegments: Segment[] = [
      'replied',
      'callback_due',
      'clicked_link',
      'new_untouched',
      'retry_channel',
    ]
    for (const segment of hotSegments) {
      for (const intent of ['low', 'unknown', null] as const) {
        expect(listOf(segment, intent)).toBe('hot')
      }
    }
  })
})

describe('verbOf', () => {
  it('excluded → do_not_contact', () => {
    expect(verbOf('excluded', 'none', 'cold')).toBe('do_not_contact')
  })

  it('nurture_future → hold', () => {
    expect(verbOf('nurture_future', 'email', 'cold')).toBe('hold')
  })

  it('handoff_sop → system_watching', () => {
    expect(verbOf('handoff_sop', 'email', 'cold')).toBe('system_watching')
  })

  it('stale_conversation 在 cold 时 → system_watching', () => {
    expect(verbOf('stale_conversation', 'phone', 'cold')).toBe('system_watching')
  })

  it('replied + messenger → reply', () => {
    expect(verbOf('replied', 'messenger', 'hot')).toBe('reply')
  })

  it('new_untouched + phone → call', () => {
    expect(verbOf('new_untouched', 'phone', 'hot')).toBe('call')
  })

  it('replied + none → reply', () => {
    expect(verbOf('replied', 'none', 'hot')).toBe('reply')
  })
})

describe('nextActionFor', () => {
  it('聊过一轮 + 高意向：line 带后缀，intentBoost 为 true', () => {
    const action = nextActionFor({
      seg: seg('stale_conversation'),
      intent: 'high',
      aiNextAction: null,
    })
    expect(action.list).toBe('hot')
    expect(action.intentBoost).toBe(true)
    expect(action.line.endsWith(INTENT_BOOST_SUFFIX)).toBe(true)
  })

  it('replied + email：line 就是「回他 —— reason-replied」，无后缀', () => {
    const action = nextActionFor({
      seg: seg('replied', { suggestedChannel: 'email' }),
      intent: null,
      aiNextAction: null,
    })
    expect(action.line).toBe('回他 —— reason-replied')
    expect(action.intentBoost).toBe(false)
    expect(action.verbLabel).toBe(VERB_LABEL.reply)
  })

  it('aiSuggestion 去掉首尾空白', () => {
    const action = nextActionFor({
      seg: seg('replied'),
      intent: null,
      aiNextAction: '  打电话给 Tim  ',
    })
    expect(action.aiSuggestion).toBe('打电话给 Tim')
  })

  it('aiSuggestion 空串 → null', () => {
    const action = nextActionFor({
      seg: seg('replied'),
      intent: null,
      aiNextAction: '',
    })
    expect(action.aiSuggestion).toBeNull()
  })

  it('aiSuggestion undefined → null', () => {
    const action = nextActionFor({
      seg: seg('replied'),
      intent: null,
      aiNextAction: undefined,
    })
    expect(action.aiSuggestion).toBeNull()
  })

  it('LIST_META 两张名单都有标题和提示', () => {
    expect(LIST_META.hot.title.length).toBeGreaterThan(0)
    expect(LIST_META.cold.title.length).toBeGreaterThan(0)
  })
})

describe('compareNextAction', () => {
  it('分段相同时，高意向排前面', () => {
    const a = { seg: seg('stale_conversation'), intent: 'high' as const }
    const b = { seg: seg('stale_conversation'), intent: 'low' as const }
    expect(compareNextAction(a, b)).toBeLessThan(0)
    expect(compareNextAction(b, a)).toBeGreaterThan(0)
  })

  it('两个都是 medium → 0', () => {
    const a = { seg: seg('stale_conversation'), intent: 'medium' as const }
    const b = { seg: seg('stale_conversation'), intent: 'medium' as const }
    expect(compareNextAction(a, b)).toBe(0)
  })

  it('分段不同时，符号跟着 compareForWorklist 走', () => {
    const a = { seg: seg('replied'), intent: null }
    const b = { seg: seg('stale_conversation'), intent: null }
    expect(compareNextAction(a, b)).toBeLessThan(0)
    expect(compareNextAction(b, a)).toBeGreaterThan(0)
  })
})
