import { describe, expect, it } from 'vitest'
import { humanPublishError, selectPendingPublishes } from './lecture-publish'

const NOW = Date.parse('2026-08-04T12:00:00Z')

function row(id: string, req: Record<string, unknown> | null) {
  return {
    id,
    client_id: 'c1',
    generation_context_snapshot: { lecture_publish_request: req },
  }
}

describe('selectPendingPublishes', () => {
  it('客户刚点发布(pending)→ 这轮就发', () => {
    const rows = [row('a', { status: 'pending', requestedAt: '2026-08-04T11:59:00Z' })]
    expect(selectPendingPublishes(rows, NOW, 3).map((r) => r.id)).toEqual(['a'])
  })

  it('正在发(刚开始)→ 不重复发', () => {
    const rows = [row('a', { status: 'sending', startedAt: '2026-08-04T11:58:00Z' })]
    expect(selectPendingPublishes(rows, NOW, 3)).toEqual([])
  })

  it('卡在「发送中」太久 → 当成掉了,重来一次(否则永远挂在那没人管)', () => {
    const rows = [row('a', { status: 'sending', startedAt: '2026-08-04T11:20:00Z' })]
    expect(selectPendingPublishes(rows, NOW, 3).map((r) => r.id)).toEqual(['a'])
  })

  it('发送中但时间读不出来 → 也当卡死处理', () => {
    expect(selectPendingPublishes([row('a', { status: 'sending' })], NOW, 3).map((r) => r.id)).toEqual(['a'])
    expect(selectPendingPublishes([row('b', { status: 'sending', startedAt: 'x' })], NOW, 3).map((r) => r.id)).toEqual(['b'])
  })

  it('已失败 / 已完成 / 没有请求 → 都不碰(失败要客户自己再点一次,不自动重试)', () => {
    const rows = [
      row('a', { status: 'failed', error: '发布没成功' }),
      row('b', { status: 'done' }),
      row('c', null),
      { id: 'd', client_id: 'c1', generation_context_snapshot: null },
    ]
    expect(selectPendingPublishes(rows, NOW, 3)).toEqual([])
  })

  it('一轮最多发 max 条(跟工单发布共用 300 秒预算)', () => {
    const rows = ['a', 'b', 'c'].map((id) => row(id, { status: 'pending' }))
    expect(selectPendingPublishes(rows, NOW, 1).map((r) => r.id)).toEqual(['a'])
    expect(selectPendingPublishes(rows, NOW, 0)).toEqual([])
  })
})

describe('humanPublishError(报错翻成客户能行动的话)', () => {
  it('不把厂商原始报错甩给客户', () => {
    expect(humanPublishError('META_SYSTEM_USER_TOKEN 未配置')).toBe('Facebook 授权没配好 — 联系我们处理')
    expect(humanPublishError('页名(X)与客户品牌(Y)不符 —— 防误发拦截'))
      .toContain('目标主页跟这个客户对不上')
  })

  it('认不出的报错也给一句人话,不返回空', () => {
    expect(humanPublishError('ECONNRESET')).toBeTruthy()
  })
})
