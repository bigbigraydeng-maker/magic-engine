/** Plain-language receipt lines for reels approved from the week list (scheduled mode). */
import type { ItemResult } from '@/lib/social/daily-list/decide'
import type { WeekPackLine } from './types'

const REFUSED_ZH: Record<string, string> = {
  not_on_list: '这条已不在下周清单上（日子变了或已处理），刷新再看',
  not_selectable: '这条现在不能批（没过发布前检查或撤回过）',
  content_changed: '内容跟你看到的不一样了，刷新再看',
  day_changed: '发布日变了，刷新再看',
  day_passed: '发布日已过',
  in_flight: '正在发或已发',
  excluded_by_card: '已被剔除',
  gate_failed: '没过发布前检查',
  write_conflict: '刚好有人在改，刷新再试',
}

export function reelListLines(receipt: { items: readonly ItemResult[]; receipt_saved: boolean }): WeekPackLine[] {
  const lines: WeekPackLine[] = receipt.items.map((r) => {
    const day = r.publish_on ? `${r.publish_on} ` : ''
    if (r.outcome === 'armed' || r.outcome === 'already_armed') {
      return { kind: 'reel', stable_id: r.work_order_id, code: 'reel_scheduled', ok: true, text: `视频 ${day}已批，到那天按时公开。` }
    }
    const why = REFUSED_ZH[r.reason ?? ''] ?? '没批成'
    return { kind: 'reel', stable_id: r.work_order_id, code: 'reel_failed', ok: false, text: `有一条视频没批：${why}。其他条不受影响。` }
  })
  if (!receipt.receipt_saved) {
    lines.push({ kind: 'reel', stable_id: null, code: 'reminder_not_saved', ok: false, text: '视频已经批了，但这次的记录没存上，告诉开发。' })
  }
  return lines
}
