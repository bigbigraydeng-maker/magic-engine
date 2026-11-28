'use client'

/**
 * 跟进信 —— 打过电话或发过信、之后一直没动静、但最近还在看我们邮件的客人，每人一封短跟进信。
 * AI 起草（现有的「让 AI 写跟进信」，只起草不发），员工看、改、勾上，点一次「放行」才逐封走现有的写邮件发送那条路。
 * 名单和分工规则：lib/crm/followup-progress/letter-list.ts。PM 2026-11-28 定：AI 只出草稿，人点了才发。
 */
import { useCallback } from 'react'
import { LetterBoard, type LetterBoardRow } from '../_components/letters/LetterBoard'

interface Row { contactId: string; name: string; lastEngagedAt: string | null; lastStaffAt: string | null; status: 'ready' | 'cannot_send'; recipient: string | null; sentLast7Days: number | null; message: string | null; requestId: string }
interface Counts { due: number; staff_active: number; already_written: number; weekly_limit: number; sentToday: number; room: number }
interface Rules { staffQuietDays: number; onePerDays: number; weeklyMax: number; dailyMax: number }

function daysAgo(iso: string | null): number | null {
  if (iso === null) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : null
}

function noteFor(r: Row): string {
  const read = daysAgo(r.lastEngagedAt)
  const staff = daysAgo(r.lastStaffAt)
  return [read === null ? '' : `${read} 天前看过邮件`, staff === null ? '' : `上次有人联系是 ${staff} 天前`].filter((p) => p !== '').join(' · ')
}

function headline(rows: Row[], c: Counts, rules: Rules): string {
  if (c.room === 0) return `今天的 ${rules.dailyMax} 封已经发完了，明天再来。还有 ${c.due} 位在排队。`
  const cannot = rows.filter((r) => r.status === 'cannot_send').length
  return `今天这一批 ${rows.length} 位${cannot > 0 ? `（其中 ${cannot} 位发不了）` : ''}。排队的一共 ${c.due} 位，每天最多 ${rules.dailyMax} 封${c.sentToday > 0 ? `，今天已发 ${c.sentToday} 封` : ''}。`
}

function otherLine(c: Counts, rules: Rules): string {
  const parts = [
    c.staff_active > 0 ? `${c.staff_active} 位最近 ${rules.staffQuietDays} 天有员工联系过，AI 不插手` : '',
    c.already_written > 0 ? `${c.already_written} 位最近 ${rules.onePerDays} 天已经从销售邮箱收过信` : '',
    c.weekly_limit > 0 ? `${c.weekly_limit} 位近 7 天已经收到 ${rules.weeklyMax} 封以上（含群发），这周不发` : '',
  ].filter((p) => p !== '')
  return parts.length === 0 ? '' : `不在这一批里的：${parts.join('；')}。客人一回信，就回到员工的名单，不会再出现在这里。`
}

export default function FollowUpLettersPage({ params }: { params: { id: string } }) {
  const clientId = params.id
  const toBoard = useCallback((json: unknown) => {
    const j = json as { rows?: Row[]; counts?: Counts; rules?: Rules } | null
    if (!j?.rows || !j.counts || !j.rules) return null
    const rows: LetterBoardRow[] = j.rows.map((r) => ({ contactId: r.contactId, name: r.name, note: noteFor(r), status: r.status, recipient: r.recipient, sentLast7Days: r.sentLast7Days, message: r.message, requestId: r.requestId }))
    return { rows, headline: headline(j.rows, j.counts, j.rules), other: otherLine(j.counts, j.rules) }
  }, [])
  return (
    <LetterBoard
      clientId={clientId}
      listUrl={`/api/clients/${clientId}/crm/followup-letters`}
      toBoard={toBoard}
      title="跟进信"
      intro="以前打过电话或发过信、之后没动静、但最近还在打开我们邮件的客人。AI 按每位客人的记录写一封短信，你看一眼、要改就改、勾上，点「放行」才会发。AI 只写草稿：不勾不发，每封照常过发信检查（7 天最多 2 封、别再联系、退订）。草稿下面的检查结果有红色 ✗ 的，改好再勾。"
      back={{ href: `/dashboard/clients/${clientId}/crm/followup-progress`, label: '跟进进度' }}
      draftAllLabel="✨ 让 AI 写这一批"
    />
  )
}
