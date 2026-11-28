/**
 * 跟进进度：所有还没成交的客人分成几组，每组多少人、谁来处理、比昨天和上周变了多少，加上这一周发生了什么。
 * 只读，只有数字，不显示任何客人的名字和联系方式。分组规则在 `lib/crm/followup-progress/groups.ts`。
 */

import type { ReactNode } from 'react'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadFollowupProgress, type FollowupProgress } from '@/lib/crm/followup-progress/load'
import { loadHistory, type DayPoint } from '@/lib/crm/followup-progress/history'
import { ProgressView } from '../_components/followup-progress/ProgressView'

export const dynamic = 'force-dynamic'

const NO_ACCESS_TEXT = '你的账号没有查看这一页的权限。'
const UNAVAILABLE_TEXT = '这一页暂时打不开，请稍后再试；如果一直这样，请告诉 Magic Engine。'

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">{children}</div>
}

function Notice({ children }: { children: ReactNode }): JSX.Element {
  return <p className="rounded border border-me-charcoal/20 bg-me-ivory p-4 text-sm text-me-charcoal">{children}</p>
}

export default async function FollowupProgressPage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return <Shell><Notice>{access.status === 401 || access.status === 403 ? NO_ACCESS_TEXT : UNAVAILABLE_TEXT}</Notice></Shell>
  }
  const now = new Date()
  let progress: FollowupProgress
  let history: DayPoint[]
  try {
    ;[progress, history] = await Promise.all([loadFollowupProgress(supabaseAdmin, params.id, now), loadHistory(supabaseAdmin, params.id, now)])
  } catch (err) {
    console.error('[crm/followup-progress] 读数失败:', err)
    return <Shell><Notice>{UNAVAILABLE_TEXT}</Notice></Shell>
  }
  return <Shell><ProgressView clientId={params.id} progress={progress} history={history} now={now} /></Shell>
}
