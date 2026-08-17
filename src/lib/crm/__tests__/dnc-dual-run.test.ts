/**
 * 双跑对比 —— 切换「只看事实」之前必须先拿到的那份名单。
 *
 * 🔴 这个工具存在的唯一理由：找出**切换后会重新开始被联系**的人。
 * 如果他们当初真说过「别再联系」、只是触点那一步写失败了，
 * 切换就是直接违反客户红线。所以判据本身错不得。
 */

import { describe, expect, it } from 'vitest'
import { compareDncVerdicts, type DualRunContact } from '../dnc-dual-run'
import type { DncTouch } from '../dnc'

const person = (over: Partial<DualRunContact> = {}): DualRunContact => ({
  id: 'p1',
  displayName: 'Sue',
  flag: false,
  touches: [],
  ...over,
})

const said = (at = '2026-08-01T00:00:00Z'): DncTouch => ({
  outcome: 'do_not_contact',
  occurredAt: at,
})

describe('会重新被联系的那批人 —— 这份名单是全部意义', () => {
  it('🔴 只有那一列说停、触点里没证据 → 进名单', () => {
    const r = compareDncVerdicts([person({ flag: true })])
    expect(r.wouldUnblock).toHaveLength(1)
    expect(r.wouldUnblock[0].contactId).toBe('p1')
    expect(r.wouldUnblock[0].touchCount).toBe(0)
  })

  it('触点里有证据 → 两套算法结论一样，不进名单', () => {
    const r = compareDncVerdicts([person({ flag: true, touches: [said()] })])
    expect(r.wouldUnblock).toEqual([])
    expect(r.blockedNow).toBe(1)
    expect(r.blockedFactsOnly).toBe(1)
  })

  it('本来就没被停的人不进名单', () => {
    const r = compareDncVerdicts([person()])
    expect(r.wouldUnblock).toEqual([])
    expect(r.blockedNow).toBe(0)
  })

  /**
   * 人明确纠正过「判错了」→ 两套算法都该判成「可以联系」。
   * 判据只有一份（`isDoNotContact`），这里钉住我们真的走了那一份。
   */
  it('人纠正过判错了 → 两边都放行，不进名单', () => {
    const r = compareDncVerdicts([
      person({
        flag: true,
        touches: [said('2026-08-01T00:00:00Z'), { outcome: 'dnc_cleared', occurredAt: '2026-08-05T00:00:00Z' }],
      }),
    ])
    expect(r.wouldUnblock).toEqual([])
    expect(r.blockedNow).toBe(0)
    expect(r.blockedFactsOnly).toBe(0)
  })

  it('触点上带 do_not_contact 标记（外呼那条路）也算证据', () => {
    const r = compareDncVerdicts([
      person({ flag: true, touches: [{ outcome: 'not_interested', flagged: true, occurredAt: '2026-08-01T00:00:00Z' }] }),
    ])
    expect(r.wouldUnblock).toEqual([])
  })
})

describe('名单要好用', () => {
  it('🔴 档案最薄的排最前 —— 那批最难判、最需要人先看', () => {
    const r = compareDncVerdicts([
      person({ id: 'many', flag: true, touches: [{ outcome: 'spoke', occurredAt: '2026-08-01T00:00:00Z' }, { outcome: 'spoke', occurredAt: '2026-08-02T00:00:00Z' }] }),
      person({ id: 'none', flag: true }),
    ])
    expect(r.wouldUnblock.map((d) => d.contactId)).toEqual(['none', 'many'])
  })

  it('带上最后一条触点的时间，人工复核时不用再点进去', () => {
    const r = compareDncVerdicts([
      person({
        flag: true,
        touches: [
          { outcome: 'spoke', occurredAt: '2026-07-01T00:00:00Z' },
          { outcome: 'spoke', occurredAt: '2026-08-09T00:00:00Z' },
        ],
      }),
    ])
    expect(r.wouldUnblock[0].lastTouchAt).toBe('2026-08-09T00:00:00Z')
  })

  it('时间戳坏了不炸', () => {
    const r = compareDncVerdicts([
      person({ flag: true, touches: [{ outcome: 'spoke', occurredAt: 'not-a-date' }] }),
    ])
    expect(r.wouldUnblock).toHaveLength(1)
  })
})

/**
 * 🔴 反方向的差异**正常情况下恒为 0**：现在的判据是「列 || 触点」，
 * 只看事实是「触点」，后者是前者的子集。真出现了说明我对现有判据的理解有错，
 * 必须停下来查清楚 —— 不能当噪音忽略。
 */
describe('反方向差异', () => {
  it('正常数据下恒为空', () => {
    const r = compareDncVerdicts([
      person({ flag: true }),
      person({ id: 'p2', flag: false, touches: [said()] }),
      person({ id: 'p3' }),
    ])
    expect(r.unexpectedNewBlocks).toEqual([])
  })
})

describe('计数', () => {
  it('看了几个人、两边各判停几个，都要数对', () => {
    const r = compareDncVerdicts([
      person({ id: 'a', flag: true }), // 只有列 → 旧停、新放
      person({ id: 'b', flag: true, touches: [said()] }), // 两边都停
      person({ id: 'c', flag: false, touches: [said()] }), // 两边都停（半写入的另一半）
      person({ id: 'd' }), // 两边都放
    ])
    expect(r.examined).toBe(4)
    expect(r.blockedNow).toBe(3)
    expect(r.blockedFactsOnly).toBe(2)
    expect(r.wouldUnblock.map((x) => x.contactId)).toEqual(['a'])
  })
})
