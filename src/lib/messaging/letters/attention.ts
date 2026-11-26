/**
 * 「没发出去」的信里，哪些要提醒人去看（纯函数，只看一行列表数据）。
 *
 * 一封信状态是「没发出去」= 一位客人也没收到。原因有两大类，提醒的轻重不一样：
 *  - 有出错 / 被退回的，或者放行了却一行发送记录都没有（引擎没动）→ 要人去看，提醒；
 *  - 全是规则内跳过（退订、别再联系、被屏蔽、最近收满了）→ 系统按规矩办了，只显示状态，不提醒。
 * （发信窗口 11-10 把提醒的轻重交给页面这边定。）
 */

import type { LetterRow } from './types'

export function needsAttention(row: Pick<LetterRow, 'status' | 'counts'>): boolean {
  return row.status === 'not_sent' && (row.counts.sent === null || (row.counts.failed ?? 0) > 0)
}
