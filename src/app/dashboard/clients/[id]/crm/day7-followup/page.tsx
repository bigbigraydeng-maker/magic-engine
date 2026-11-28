'use client'

/**
 * 第 7 天跟进信 —— 发了 2027 目录满 7 天、没点开、没回话、也没人写过信的「AI 跟进中」客人。
 * AI 按每位客人的情况起草一封短跟进信（现有的「让 AI 写跟进信」，只起草不发），员工在这一页看、改、勾上，
 * 点一次「放行」才逐封走现有的写邮件发送那条路（所有发信检查照跑：7 天 2 封、别再联系、退订…）。
 * 名单：lib/crm/ai-takeover/day7.ts、day7-list.ts。PM 11-09 / 11-14 定：前两周员工点放行，满意后 PM 回「放开」才全自动。
 */
import { useCallback } from 'react'
import { LetterBoard, type LetterBoardRow } from '../_components/letters/LetterBoard'

interface Row { contactId: string; name: string; day: number; status: 'ready' | 'cannot_send'; recipient: string | null; sentLast7Days: number | null; message: string | null; requestId: string }
type Counts = Record<'due' | 'not_yet' | 'past_30' | 'stopped' | 'clicked' | 'already_written', number>

function otherLine(c: Counts): string {
  const parts = [
    c.not_yet > 0 ? `${c.not_yet} 位还没满 7 天` : '',
    c.clicked > 0 ? `${c.clicked} 位点开过目录（已回到「今天要联系」）` : '',
    c.stopped > 0 ? `${c.stopped} 位已经订团、说过别再联系、阶段有了结论、自己回来过或员工聊上了（不再由 AI 写）` : '',
    c.already_written > 0 ? `${c.already_written} 位发目录后已经有人写过信` : '',
    c.past_30 > 0 ? `${c.past_30} 位超过 30 天，AI 不再写信` : '',
  ].filter((p) => p !== '')
  return parts.length === 0 ? '' : `另外：${parts.join('；')}。`
}

export default function Day7FollowUpPage({ params }: { params: { id: string } }) {
  const clientId = params.id
  const toBoard = useCallback((json: unknown) => {
    const j = json as { rows?: Row[]; counts?: Counts } | null
    if (!j?.rows || !j.counts) return null
    const rows: LetterBoardRow[] = j.rows.map((r) => ({ ...r, note: `发目录第 ${r.day} 天` }))
    const cannot = rows.filter((r) => r.status === 'cannot_send').length
    return { rows, headline: `今天该写 ${rows.length} 位${cannot > 0 ? `（其中 ${cannot} 位发不了）` : ''}。`, other: otherLine(j.counts) }
  }, [])
  return (
    <LetterBoard
      surface="day7_page"
      clientId={clientId}
      listUrl={`/api/clients/${clientId}/crm/ai-pickup/day7`}
      toBoard={toBoard}
      title="第 7 天跟进信"
      intro="发了目录满 7 天、没点开、没回话、也没人写过信的客人。AI 按每位客人问过的团写一封短信，你看一眼、要改就改、勾上，点「放行」才会发。每封都照常过发信检查（7 天最多 2 封、别再联系、退订）。"
      back={{ href: `/dashboard/clients/${clientId}/crm/ai-pickup`, label: '交给 AI 跟进' }}
      draftAllLabel="✨ 让 AI 把这些信都起草出来"
    />
  )
}
