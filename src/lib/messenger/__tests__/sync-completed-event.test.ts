/**
 * 「私信同步跑完了」这张条子的判据。
 *
 * 这张条子替换掉的是 `render.yaml` 里那个 `&&` —— 它守错了信号，把「网关超时」
 * 当成「同步失败」，害得客户需求卡停更 14 天。所以这里测的核心只有一条：
 * **什么情况下卡该照写。**
 */

import { describe, it, expect } from 'vitest'
import {
  MESSENGER_SYNC_COMPLETED_EVENT,
  parseSyncCompleted,
  syncCompletedEventId,
  type MessengerSyncCompletedData,
} from '../sync-completed-event'

function receipt(over: Partial<MessengerSyncCompletedData> = {}): Record<string, unknown> {
  return {
    clients: 5,
    conversations: 3,
    messages: 7,
    new_contacts: 1,
    failed: 0,
    mailbox_error: null,
    completed_at: '2026-09-07T21:12:31.000Z',
    ...over,
  }
}

describe('条子的形状', () => {
  it('同步路由真发出去的那份回执被接受', () => {
    const r = parseSyncCompleted(receipt())
    expect(r.ok).toBe(true)
  })

  it('🔴 一条消息都没拉到也照样接受 —— 卡写的是库里已有的对话', () => {
    // 深夜那几个小时 Messenger 常常一条新消息都没有。若这里判「没新消息就不写卡」，
    // 那批小时会一张卡都不出，而积压的老对话本来就该在那时候被写掉。
    const r = parseSyncCompleted(receipt({ messages: 0, conversations: 0, new_contacts: 0 }))
    expect(r.ok).toBe(true)
  })

  it('🔴 部分客户同步失败也照样接受 —— 跟改造之前的行为一致', () => {
    // 改造之前：单个客户失败只记一笔，路由仍返 200，`&&` 后面那条 curl 照跑。
    // 这里若收紧成「failed>0 就不写卡」，就是借这次修复偷偷改了业务行为。
    const r = parseSyncCompleted(receipt({ failed: 2 }))
    expect(r.ok).toBe(true)
  })

  it('邮箱那半边整段失败不挡写卡', () => {
    expect(parseSyncCompleted(receipt({ mailbox_error: 'token expired' })).ok).toBe(true)
  })

  it.each([
    ['不是对象', 'nope'],
    ['是 null', null],
  ])('读不懂的东西被拒绝：%s', (_label, data) => {
    expect(parseSyncCompleted(data).ok).toBe(false)
  })

  it('缺 completed_at 被拒绝（没有它就没法知道这是哪一轮）', () => {
    const bad = receipt()
    delete bad.completed_at
    expect(parseSyncCompleted(bad)).toMatchObject({ ok: false, reason: 'completed_at_missing' })
  })

  it.each(['clients', 'conversations', 'messages', 'new_contacts', 'failed'])(
    '%s 不是数字就拒绝（字符串 "0" 混进来会让后面的统计悄悄变成拼接）',
    (field) => {
      const r = parseSyncCompleted(receipt({ [field]: '0' } as never))
      expect(r).toMatchObject({ ok: false, reason: `${field}_not_a_number` })
    },
  )
})

describe('条子的 id', () => {
  it('同一小时里的两次同步共用一个 id（手动补触发不会再触发一整批卡）', () => {
    const a = syncCompletedEventId(new Date('2026-09-07T21:12:31.000Z'))
    const b = syncCompletedEventId(new Date('2026-09-07T21:58:04.000Z'))
    expect(a).toBe(b)
  })

  it('跨小时是不同的 id —— 否则每小时那一轮会被上一轮去重掉，直接复刻这次事故', () => {
    const a = syncCompletedEventId(new Date('2026-09-07T21:12:31.000Z'))
    const b = syncCompletedEventId(new Date('2026-09-07T22:12:31.000Z'))
    expect(a).not.toBe(b)
  })
})

describe('事件名', () => {
  it('带 me/ 前缀，跟仓里其他云端事件一致', () => {
    expect(MESSENGER_SYNC_COMPLETED_EVENT).toBe('me/messenger.sync.completed')
  })
})
