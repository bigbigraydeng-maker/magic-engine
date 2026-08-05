import { describe, it, expect } from 'vitest'
import { assessEvidence, canCreateLesson, requiresApproval } from '../evidence'

const NOTHING = {
  userCorrections: 0,
  testsPassed: false,
  mergedShas: [],
  observedInSessions: 1,
}

describe('assessEvidence — 全自动入库下唯一的闸门', () => {
  it('什么证据都没有时必须拒收', () => {
    const v = assessEvidence(NOTHING)
    expect(v.primary).toBeNull()
    expect(v.kinds).toEqual([])
    expect(v.rejectedReason).toBeTruthy()
  })

  it('「跑了一堆工具但没结果」不算证据', () => {
    // 这条是整套系统的底线：Claude 说自己搞定了，永远不是证据
    const v = assessEvidence({ ...NOTHING, observedInSessions: 1 })
    expect(v.primary).toBeNull()
  })

  it('PM 当场纠正过 = 最强证据', () => {
    const v = assessEvidence({ ...NOTHING, userCorrections: 1 })
    expect(v.primary).toBe('user_correction')
    expect(v.confidence).toBeGreaterThan(0.9)
  })

  it('改动合进 main 算证据', () => {
    const v = assessEvidence({ ...NOTHING, mergedShas: ['abc123'] })
    expect(v.kinds).toContain('merged')
  })

  it('单次重现不算模式，两次才算', () => {
    expect(assessEvidence({ ...NOTHING, observedInSessions: 1 }).kinds).not.toContain('multi_session')
    expect(assessEvidence({ ...NOTHING, observedInSessions: 2 }).kinds).toContain('multi_session')
  })

  it('多种证据叠加会加分，但永远不到 1.0 —— 给推翻留余地', () => {
    const v = assessEvidence({
      userCorrections: 2,
      testsPassed: true,
      mergedShas: ['a', 'b'],
      observedInSessions: 3,
    })
    expect(v.kinds.length).toBe(4)
    expect(v.confidence).toBeGreaterThan(0.95)
    expect(v.confidence).toBeLessThan(1)
  })
})

describe('canCreateLesson — 谁有资格开新条目', () => {
  it('光靠「同一批文件被碰过两次」不能开新教训', () => {
    // 这是全自动入库下最容易漏进垃圾的口子：改同一个文件两次就凑够 2 次，
    // 那只是"在同一片区域干过活"，不是"同一个结论被印证过"。
    const v = assessEvidence({ ...NOTHING, observedInSessions: 5 })
    expect(v.kinds).toContain('multi_session')
    expect(canCreateLesson(v)).toBe(false)
  })

  it('PM 纠正 / 已合入 / 测试通过 才能开新教训', () => {
    expect(canCreateLesson(assessEvidence({ ...NOTHING, userCorrections: 1 }))).toBe(true)
    expect(canCreateLesson(assessEvidence({ ...NOTHING, mergedShas: ['a'] }))).toBe(true)
    expect(canCreateLesson(assessEvidence({ ...NOTHING, testsPassed: true }))).toBe(true)
  })

  it('什么都没有当然不能开', () => {
    expect(canCreateLesson(assessEvidence(NOTHING))).toBe(false)
  })
})

describe('requiresApproval — 套路自动上线，但执行仍要 PM 放行', () => {
  it('合并到 main 的步骤要放行', () => {
    expect(requiresApproval([{ action: '跑 gh pr merge --squash' }])).toBe(true)
  })

  it('建表 / 改表的步骤要放行', () => {
    expect(requiresApproval([{ action: 'apply_migration 新建 xxx 表' }])).toBe(true)
    expect(requiresApproval([{ action: 'ALTER TABLE clients 加一列' }])).toBe(true)
  })

  it('对外发布 / 花钱的步骤要放行', () => {
    expect(requiresApproval([{ action: '把这条内容发布到 Facebook' }])).toBe(true)
    expect(requiresApproval([{ action: '把广告预算调到 $50/天' }])).toBe(true)
    expect(requiresApproval([{ action: '给客户群发邮件' }])).toBe(true)
  })

  it('删除类步骤要放行', () => {
    expect(requiresApproval([{ action: '删除旧的分支' }])).toBe(true)
  })

  it('纯读 / 纯本地的步骤不用放行', () => {
    expect(
      requiresApproval([
        { action: '读 src/lib/foo.ts 看现有写法' },
        { action: '跑 npm run build 确认能编译' },
      ]),
    ).toBe(false)
  })
})
