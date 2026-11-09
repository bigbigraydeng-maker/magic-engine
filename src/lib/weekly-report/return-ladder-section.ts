/**
 * 周报「广告一本账」区块 · 纯 HTML 渲染（只出字符串，无 I/O）。
 *
 * 规矩：
 *  - 平台通用：本文件不出现任何客户 / 行业 / 广告平台的名字。
 *  - 凡是来自数据的文字（客户名、错误信息、每一行、标题）一律过 esc。
 *  - 读不出来就如实写「没读出来」，不许用默认值糊过去。
 */

import { esc } from '@/lib/pm-todo/daily-todo'
import { ladderHeadline, ladderLines } from '@/lib/ads-strategy/return-ladder/render'
import type { ClientReturnLadder, ReturnLadderSection } from './return-ladder-gather'

const CONVERSIONS_URL = 'https://app.magicengine.com.au/dashboard/conversions'

const BLOCK_STYLE = 'margin:0 0 10px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px'
const TITLE_STYLE = 'margin:0 0 6px;font-size:13px;font-weight:700;color:#0f172a'
const LINE_STYLE = 'margin:0 0 4px;font-size:14px;color:#334155'
const NAME_STYLE = 'margin:10px 0 4px;font-size:14px;font-weight:700;color:#0f172a'
const SECTION_TITLE_STYLE = 'margin:18px 0 8px;font-size:16px;color:#0f172a'

function line(text: string): string {
  return `<p style="${LINE_STYLE}">${esc(text)}</p>`
}

/** 一个客户的「广告一本账」块（放在该客户「社媒广告」块正下方）。 */
export function renderLadderBlock(row: ClientReturnLadder): string {
  const parts: string[] = []
  parts.push(`<p style="${TITLE_STYLE}">📒 广告一本账 · ${esc(ladderHeadline(row.ladder))}</p>`)
  for (const text of ladderLines(row.ladder, { resultNoun: row.resultNoun })) parts.push(line(text))
  if (row.ladder.reachedLevel < 5) {
    parts.push(
      `<p style="${LINE_STYLE}">成交没填回来就算不到后面几级 · <a href="${CONVERSIONS_URL}" style="color:#0891b2">去回填 / 审核成交</a></p>`,
    )
  }
  return `<div style="${BLOCK_STYLE}">${parts.join('')}</div>`
}

/** 重点客户有广告但这一栏没读出来时用的占位块。 */
export function renderLadderUnavailable(reason: string): string {
  const text = `<span style="color:#dc2626">⚠️ 这一栏这周没读出来（${esc(reason.slice(0, 160))}）—— 不等于没有数</span>`
  return `<div style="${BLOCK_STYLE}"><p style="${TITLE_STYLE}">📒 广告一本账</p><p style="${LINE_STYLE}">${text}</p></div>`
}

/** 重点客户之外、其它有广告花费的客户：邮件末尾单列一节。 */
export function renderOtherLadders(section: ReturnLadderSection | undefined, shownClientIds: readonly string[]): string {
  if (section === undefined) return ''
  // 整段读失败：重点客户那边各自有占位块；这里也要说一声，否则其它客户会悄悄消失。
  if ('error' in section) {
    return `<h3 style="${SECTION_TITLE_STYLE}">其它有广告的客户</h3>${renderLadderUnavailable(section.error)}`
  }
  const shown = new Set(shownClientIds)
  const rows = section.rows.filter(r => !shown.has(r.client_id))
  const failures = section.failed.filter(f => !shown.has(f.client_id))
  if (rows.length === 0 && failures.length === 0) return ''
  const parts: string[] = [`<h3 style="${SECTION_TITLE_STYLE}">其它有广告的客户</h3>`]
  for (const row of rows) {
    parts.push(`<p style="${NAME_STYLE}">${esc(row.name)}</p>`)
    parts.push(renderLadderBlock(row))
  }
  for (const failure of failures) {
    parts.push(`<p style="${NAME_STYLE}">${esc(failure.name)}</p>`)
    parts.push(renderLadderUnavailable(failure.error))
  }
  return parts.join('')
}
