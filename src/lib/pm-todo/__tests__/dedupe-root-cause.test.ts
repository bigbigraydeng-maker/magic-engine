import { describe, it, expect } from 'vitest'
import { foldRootCauseDuplicates } from '../dedupe-root-cause'
import { laneOf } from '../five-kinds'
import type { ManualItem, ManualItemKind } from '../manual-item-types'

function item(kind: ManualItemKind, client_id: string, what: string): ManualItem {
  return { kind, client_id, client_name: client_id || '全站', what, how: 'how', href: 'https://x' }
}

const TRACKER = (c: string, cause = '余额/配额用完×20') =>
  item('ai_tracker_all_failed', c, `这周的 AI 可见度体检全挂了（20 条探测全部失败：${cause}）`)

describe('foldRootCauseDuplicates', () => {
  it('AI 余额用完在场：各客户体检全挂（余额类）改归开发栏，不删', () => {
    const r = foldRootCauseDuplicates([item('ai_provider_exhausted', '', '余额用完'), TRACKER('a'), TRACKER('b')])
    expect(r.items).toHaveLength(3)
    expect(r.demotedToDev).toBe(2)
    expect(r.items.filter((i) => i.kind === 'ai_tracker_all_failed_dev')).toHaveLength(2)
    expect(laneOf(r.items[1])).toBe('dev')
    expect(laneOf(r.items[0])).toBe('one_click') // 主因仍在 PM 栏
  })

  it('没有主因在场：一条都不动（宁可多报）', () => {
    const input = [TRACKER('a'), TRACKER('b')]
    const r = foldRootCauseDuplicates(input)
    expect(r.items.map((i) => i.kind)).toEqual(['ai_tracker_all_failed', 'ai_tracker_all_failed'])
    expect(r.demotedToDev).toBe(0)
  })

  it('主因在场但体检全挂不是余额类原因：不动', () => {
    const r = foldRootCauseDuplicates([item('ai_provider_exhausted', '', 'x'), TRACKER('a', '钥匙失效×20')])
    expect(r.items[1].kind).toBe('ai_tracker_all_failed')
  })

  it('同一客户「Facebook 授权断了」+「私信同步连续失败」：留前一条，去掉后一条', () => {
    const r = foldRootCauseDuplicates([
      item('platform_connection_broken', 'roman', 'Facebook / Instagram 授权断了 35 天'),
      item('facebook_sync_failing', 'roman', '私信同步连续 3 次失败'),
      item('facebook_sync_failing', 'east', '私信同步连续 3 次失败'),
    ])
    expect(r.droppedDuplicates).toBe(1)
    expect(r.items.map((i) => `${i.kind}:${i.client_id}`)).toEqual([
      'platform_connection_broken:roman',
      'facebook_sync_failing:east',
    ])
  })

  it('授权断了的不是 Facebook（例如邮箱）：不去掉同步失败那条', () => {
    const r = foldRootCauseDuplicates([
      item('platform_connection_broken', 'cts', '客户邮箱的授权已经断了 26 天'),
      item('facebook_sync_failing', 'cts', '私信同步连续 3 次失败'),
    ])
    expect(r.droppedDuplicates).toBe(0)
    expect(r.items).toHaveLength(2)
  })

  it('不修改传入的数组', () => {
    const input = [item('ai_provider_exhausted', '', 'x'), TRACKER('a')]
    foldRootCauseDuplicates(input)
    expect(input[1].kind).toBe('ai_tracker_all_failed')
  })
})
