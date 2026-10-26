import { describe, it, expect } from 'vitest'
import { SEGMENT_META, compareForWorklist, type Segment, type SegmentResult } from '../segments'
import {
  BASE_LIST_OF_SEGMENT,
  INTENT_LEVELS,
  LIST_META,
  VERB_LABEL,
  compareNextAction,
  intentNote,
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

  it('意向不动人：每个分段 × 每个意向都等于基础名单', () => {
    for (const segment of ALL_SEGMENTS) {
      for (const intent of ALL_INTENTS) {
        expect(listOf(segment, intent)).toBe(BASE_LIST_OF_SEGMENT[segment])
      }
    }
  })

  it('聊过一轮就断了 + 高意向 → 仍然 cold（意向未校准，不抬人）', () => {
    expect(listOf('stale_conversation', 'high')).toBe('cold')
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

describe('intentNote', () => {
  it('high / medium / low 各给一行小字', () => {
    expect(intentNote('high')).toBe('AI 初判（未校准）：意向高')
    expect(intentNote('medium')).toBe('AI 初判（未校准）：意向中')
    expect(intentNote('low')).toBe('AI 初判（未校准）：意向低')
  })

  it('unknown / null → null（不显示）', () => {
    expect(intentNote('unknown')).toBeNull()
    expect(intentNote(null)).toBeNull()
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
  it('聊过一轮 + 高意向：仍然 cold / system_watching，intentBoost 恒为 false', () => {
    const action = nextActionFor({
      seg: seg('stale_conversation'),
      intent: 'high',
      aiNextAction: null,
    })
    expect(action.list).toBe('cold')
    expect(action.verb).toBe('system_watching')
    expect(action.intentBoost).toBe(false)
    expect(action.line).not.toContain('意向')
  })

  it('replied + email：line 就是「回他 —— reason-replied」，reason 不带后缀', () => {
    const action = nextActionFor({
      seg: seg('replied', { suggestedChannel: 'email' }),
      intent: null,
      aiNextAction: null,
    })
    expect(action.line).toBe('回他 —— reason-replied')
    expect(action.reason).toBe('reason-replied')
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

describe('compareNextAction —— hot 里一条规则：最近有动静的排前面', () => {
  it('两个 replied：昨天排在两个月前前面', () => {
    const recent = { seg: seg('replied', { lastTouchAt: '2026-10-09T00:00:00.000Z' }), intent: null }
    const old = { seg: seg('replied', { lastTouchAt: '2026-08-07T00:00:00.000Z' }), intent: null }
    expect(compareNextAction(recent, old)).toBeLessThan(0)
    expect(compareNextAction(old, recent)).toBeGreaterThan(0)
  })

  it('最近度压过分段优先级：new_untouched（9-29）排在 replied（8-07）前面', () => {
    const a = { seg: seg('replied', { lastTouchAt: '2026-08-07T00:00:00.000Z' }), intent: null }
    const b = { seg: seg('new_untouched', { lastTouchAt: '2026-09-29T00:00:00.000Z' }), intent: null }
    expect(compareNextAction(b, a)).toBeLessThan(0)
    expect(compareNextAction(a, b)).toBeGreaterThan(0)
  })

  it('约好今天回电的永远在最前，哪怕很久没动静', () => {
    const due = { seg: seg('callback_due', { lastTouchAt: '2026-08-01T00:00:00.000Z' }), intent: null }
    const replied = { seg: seg('replied', { lastTouchAt: '2026-10-10T00:00:00.000Z' }), intent: null }
    expect(compareNextAction(due, replied)).toBeLessThan(0)
    expect(compareNextAction(replied, due)).toBeGreaterThan(0)
  })

  it('没有任何触点的新人（lastTouchAt 为空）当成「刚刚」，排最前', () => {
    const fresh = { seg: seg('new_untouched', { lastTouchAt: null }), intent: null }
    const replied = { seg: seg('replied', { lastTouchAt: '2026-10-10T00:00:00.000Z' }), intent: null }
    expect(compareNextAction(fresh, replied)).toBeLessThan(0)
    expect(compareNextAction(replied, fresh)).toBeGreaterThan(0)
  })

  it('意向不影响排序：同样的两个人，一个 high 一个 low → 0', () => {
    const a = { seg: seg('replied'), intent: 'high' as const }
    const b = { seg: seg('replied'), intent: 'low' as const }
    expect(compareNextAction(a, b)).toBe(0)
  })

  it('cold 沿用引擎原排序：符号跟 compareForWorklist 一致', () => {
    const older = { seg: seg('stale_conversation', { lastTouchAt: '2026-09-03T00:00:00.000Z' }), intent: null }
    const newer = { seg: seg('stale_conversation', { lastTouchAt: '2026-10-07T00:00:00.000Z' }), intent: null }
    expect(Math.sign(compareNextAction(older, newer))).toBe(
      Math.sign(compareForWorklist(older.seg, newer.seg)),
    )
  })
})
