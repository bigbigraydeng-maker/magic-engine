/**
 * 跟进进度：所有还没成交的客人分成几组，每组多少人、谁来处理、比昨天和上周变了多少，加上这一周发生了什么。
 * 只读。总览只有数字；带 `?group=` 时列出那一组客人的名字和几个日期（不显示邮箱和电话）。
 * 分组规则在 `lib/crm/followup-progress/groups.ts`。
 */

import type { ReactNode } from 'react'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadFollowupProgress, type FollowupProgressDetail } from '@/lib/crm/followup-progress/load'
import { buildGroupList, memberIds, parseGroup } from '@/lib/crm/followup-progress/group-list'
import { loadContactNames } from '@/lib/crm/enquiry-daily-load'
import { GroupListView } from '../_components/followup-progress/GroupListView'
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

/** Dates on the group list are shown in the client's local day. One time zone today, same as the daily snapshot. */
const LIST_TZ = 'Pacific/Auckland'

export default async function FollowupProgressPage({ params, searchParams }: { params: { id: string }; searchParams?: { group?: string | string[] } }): Promise<JSX.Element> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return <Shell><Notice>{access.status === 401 || access.status === 403 ? NO_ACCESS_TEXT : UNAVAILABLE_TEXT}</Notice></Shell>
  }
  const now = new Date()
  let progress: FollowupProgressDetail
  let history: DayPoint[]
  try {
    ;[progress, history] = await Promise.all([loadFollowupProgress(supabaseAdmin, params.id, now), loadHistory(supabaseAdmin, params.id, now)])
  } catch (err) {
    console.error('[crm/followup-progress] 读数失败:', err)
    return <Shell><Notice>{UNAVAILABLE_TEXT}</Notice></Shell>
  }
  const group = parseGroup(searchParams?.group)
  if (group !== null) {
    try {
      const names = await loadContactNames(supabaseAdmin, params.id, memberIds(progress, group))
      return <Shell><GroupListView clientId={params.id} list={buildGroupList(progress, group, names)} timeZone={LIST_TZ} /></Shell>
    } catch (err) {
      console.error('[crm/followup-progress] 读名单失败:', err)
      return <Shell><Notice>{UNAVAILABLE_TEXT}</Notice></Shell>
    }
  }
  return <Shell><ProgressView clientId={params.id} progress={progress} history={history} now={now} /></Shell>
}
