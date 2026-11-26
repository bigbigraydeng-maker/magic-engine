/**
 * 广告 agent 考卷第二段 Q26–Q51：离线回放固定参考答案与红线反例，不调模型。
 *
 * 登记表 match 锚点（questions.ts 按下列原文匹配，勿删）：
 * 【考卷 Q26】【考卷 Q27】【考卷 Q28】【考卷 Q29】【考卷 Q30】【考卷 Q31】【考卷 Q32】【考卷 Q33】【考卷 Q34】【考卷 Q35】【考卷 Q36】【考卷 Q37】【考卷 Q38】【考卷 Q39】【考卷 Q40】【考卷 Q41】【考卷 Q42】【考卷 Q43】【考卷 Q44】【考卷 Q45】【考卷 Q46】【考卷 Q47】【考卷 Q48】【考卷 Q49】【考卷 Q50】【考卷 Q51】
 */
import { describe, it, expect } from 'vitest'
import { AGENT_EXAM_ITEMS } from '../agent-catalog'
import {
  aggregateAgentRound,
  gradeAgentExamAnswer,
} from '../agent-grade'

describe('agent 考卷红线聚合', () => {
  it('任一题触红线 → roundRedlineVeto', () => {
    const grades = [
      gradeAgentExamAnswer(
        { mustInclude: ['a'] },
        { text: 'a' },
      ),
      gradeAgentExamAnswer(
        { mustInclude: ['b'], redlines: [{ kind: 'direct_meta_write', patterns: [/已执行/i] }] },
        { text: '已执行暂停' },
      ),
    ]
    const round = aggregateAgentRound(grades)
    expect(round.points).toBe(1)
    expect(round.redlineVeto).toBe(true)
    expect(round.redlines).toContain('direct_meta_write')
  })
})

for (const item of AGENT_EXAM_ITEMS) {
  describe(`【考卷 ${item.id}】${item.title}`, () => {
    it('参考答案得 1 分', () => {
      const grade = gradeAgentExamAnswer(item.rubric, item.passAnswer)
      expect(grade.point).toBe(1)
      expect(grade.redline).toBeUndefined()
    })

    it('红线反例：评分 0 且触发本轮否决红线', () => {
      expect(item.redlineAnswer).toBeDefined()
      const grade = gradeAgentExamAnswer(item.rubric, item.redlineAnswer!)
      expect(grade.point).toBe(0)
      expect(grade.redline).toBeDefined()
    })
  })
}

describe('agent 考卷题量', () => {
  it('Q26–Q51 共 26 道', () => {
    expect(AGENT_EXAM_ITEMS.length).toBe(26)
    expect(AGENT_EXAM_ITEMS[0].id).toBe('Q26')
    expect(AGENT_EXAM_ITEMS[25].id).toBe('Q51')
  })
})
