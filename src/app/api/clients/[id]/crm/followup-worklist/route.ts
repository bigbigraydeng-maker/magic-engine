/**
 * 「分给某位跟进人、客人在等、还没人回」的名单 —— 只读。
 *
 * 用途：「每天提醒跟进人」第一刀（不发信）。先把真实名单摆出来给 PM 看，
 * 再决定信怎么写、发给谁。名单怎么来的见 `lib/crm/assignee-worklist`。
 *
 * 🔴 **只读，没有任何写操作，也不发任何东西。**
 * 🔴 **响应里没有邮箱和电话**：名字过 `digestName`（名字本身可能是个邮箱地址），
 *    一行标题（表单选的团 / 邮件主题）过 `scrubContactDetails`；点开客人抽屉才看得到联系方式。
 * 鉴权跟 CRM 其他接口同一道（`requirePaidClientAccess`）：能看这个客户的 CRM 的人，才能看这份名单。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { contactUrl, digestName, scrubContactDetails } from '@/lib/crm/digest-shared'
import { findAssigneeWorklist, UNASSIGNED, type WorklistSource } from '@/lib/crm/assignee-worklist'

interface RouteParams {
  params: { id: string }
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export interface WorklistEntryView {
  contactId: string
  name: string
  sources: WorklistSource[]
  waitingHours: number
  waitingSince: string
  headline: string | null
  assignedTo: string | null
  url: string
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const url = new URL(req.url)
  // 不传 = 全部；`unassigned` = 还没分的；其它当跟进人的登录邮箱（统一小写，库里存的就是小写）。
  const rawAssignee = url.searchParams.get('assignee')?.trim() ?? ''
  const assignee = rawAssignee === '' ? undefined : rawAssignee === UNASSIGNED ? UNASSIGNED : rawAssignee.toLowerCase()
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), MAX_LIMIT) : DEFAULT_LIMIT

  const result = await findAssigneeWorklist(supabaseAdmin, clientId, new Date(), { assignee })

  const entries: WorklistEntryView[] = result.entries.slice(0, limit).map((e) => ({
    contactId: e.contactId,
    name: digestName(e.displayName),
    sources: e.sources,
    waitingHours: e.waitingHours,
    waitingSince: e.waitingSince,
    headline: e.headline ? scrubContactDetails(e.headline) : null,
    assignedTo: e.assignedTo,
    url: contactUrl(clientId, e.contactId),
  }))

  return NextResponse.json({
    assignee: assignee ?? null,
    total: result.entries.length,
    returned: entries.length,
    entries,
    detected: result.detected,
    byAssignee: result.byAssignee,
    strangerEmails: result.strangerEmails,
    // 非空 = 名单不完整（某个渠道没测成），不是「这个渠道没有人」。
    errors: result.errors,
    generatedAt: new Date().toISOString(),
  })
}
