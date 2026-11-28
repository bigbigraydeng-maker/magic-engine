'use client'

/**
 * 跟进信 —— 打过电话或发过信、之后一直没动静、但最近还在看我们邮件的客人，每人一封短跟进信。
 * AI 起草（现有的「让 AI 写跟进信」，只起草不发），员工看、改、勾上，点一次「放行」才逐封走现有的写邮件发送那条路。
 * 名单和分工规则：lib/crm/followup-progress/letter-list.ts。PM 2026-11-28 定：AI 只出草稿，人点了才发。
 */
import { useCallback } from 'react'
import { LetterBoard, type LetterBoardRow } from '../_components/letters/LetterBoard'

interface Row { contactId: string; name: string; lastEngagedAt: string | null; lastActivityAt: string | null; status: 'ready' | 'cannot_send'; recipient: string | null; sentLast7Days: number | null; message: string | null; requestId: string }
interface Counts { due: number; staff_today: number; parked: number; callback_set: number; declined: number; recent_activity: number; already_written: number; no_reply_stop: number; weekly_limit: number; sentToday: number; room: number }
interface Rules { quietDays: number; onePerDays: number; maxUnanswered: number; weeklyMax: number; dailyMax: number }

function daysAgo(iso: string | null): number | null {
  if (iso === null) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : null
}

function noteFor(r: Row): string {
  const read = daysAgo(r.lastEngagedAt)
  const quiet = daysAgo(r.lastActivityAt)
  return [read === null ? '' : `${read} 天前看过邮件`, quiet === null ? '' : `上次有来往是 ${quiet} 天前`].filter((p) => p !== '').join(' · ')
}

function headline(rows: Row[], c: Counts, rules: Rules): string {
  if (c.room === 0) return `今天销售邮箱已经发出 ${c.sentToday} 封自己写的信（员工自己写的也算），到了这一页每天 ${rules.dailyMax} 封的上限，明天再来。还有 ${c.due} 位在排队。`
  const cannot = rows.filter((r) => r.status === 'cannot_send').length
  return `今天这一批 ${rows.length} 位${cannot > 0 ? `（其中 ${cannot} 位发不了）` : ''}。排队的一共 ${c.due} 位，每天最多 ${rules.dailyMax} 封${c.sentToday > 0 ? `，今天已发 ${c.sentToday} 封` : ''}。`
}

function otherLine(c: Counts, rules: Rules): string {
  const parts = [
    c.staff_today > 0 ? `${c.staff_today} 位在员工「今天先联系」的名单上（回了话、点了链接、约的回电到了…），归员工` : '',
    c.recent_activity > 0 ? `${c.recent_activity} 位最近 ${rules.quietDays} 天有过来往（打过电话哪怕没接、发过消息、客人来过消息），AI 不插手` : '',
    c.callback_set > 0 ? `${c.callback_set} 位有员工约了回电` : '',
    c.declined > 0 ? `${c.declined} 位说过暂时不考虑` : '',
    c.parked > 0 ? `${c.parked} 位被放着或已排除` : '',
    c.already_written > 0 ? `${c.already_written} 位最近 ${rules.onePerDays} 天已经从销售邮箱收过信` : '',
    c.no_reply_stop > 0 ? `${c.no_reply_stop} 位写过 ${rules.maxUnanswered} 封没有回音，不再写` : '',
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
  // The release route judges the guest again and re-checks the text before the existing send.
  const sendUrl = useCallback(() => `/api/clients/${clientId}/crm/followup-letters/release`, [clientId])
  return (
    <LetterBoard
      clientId={clientId}
      listUrl={`/api/clients/${clientId}/crm/followup-letters`}
      toBoard={toBoard}
      title="跟进信"
      intro="以前打过电话或发过信、之后没动静、但最近还在打开我们邮件的客人。AI 按每位客人的记录写一封短信，你看一眼、要改就改、勾上，点「放行」才会发。AI 只写草稿，不勾不发。检查有红色 ✗ 的勾不了，改好并重新检查才行。放行那一刻系统会再查一遍：这位客人要是刚有员工联系过、或自己来了消息，这封就不发。"
      back={{ href: `/dashboard/clients/${clientId}/crm/followup-progress`, label: '跟进进度' }}
      draftAllLabel="✨ 让 AI 写这一批"
      sendUrl={sendUrl}
    />
  )
}
