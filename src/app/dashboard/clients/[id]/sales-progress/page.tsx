/**
 * 销售进度 —— 按出发日看：座位上限、已订人数（公司确认 / 客人自述 / 待核实）、剩余。只读。
 *
 * 服务端页：先过订单与付款那道名单闸（requireBookingAccess），再在服务端取数；
 * 没有任何单独的取数接口，所以没有第二道门要守。读失败显示「暂时打不开」，
 * 绝不显示成「没有订单」。座位上限只读各出发日的内部座位与对外团级上限，不写任何东西。
 */

import type { ReactNode } from 'react'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import { loadSalesProgress, type SalesProgressData } from '@/lib/crm/sales-progress/load'
import { createDepartureUnitSource } from '@/lib/crm/sales-progress/units'
import { supabaseAdmin } from '@/lib/supabase'
import { CrmTabs } from '../crm/_components/CrmTabs'
import { SalesProgressTable } from './_components/SalesProgressTable'

export const dynamic = 'force-dynamic'

const NO_ACCESS_TEXT = '你的账号没有查看这一页的权限。'
const NOT_AVAILABLE_TEXT = '这个客户还没有开通这一页。'
const UNAVAILABLE_TEXT = '这一页暂时打不开，请稍后再试；如果一直这样，请告诉 Magic Engine。'

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">{children}</div>
}

function Notice({ text }: { text: string }): JSX.Element {
  return <p className="rounded border border-me-charcoal/20 bg-me-ivory p-4 text-sm text-me-charcoal">{text}</p>
}

function noticeFor(status: number): string {
  if (status === 401 || status === 403) return NO_ACCESS_TEXT
  if (status === 404) return NOT_AVAILABLE_TEXT
  return UNAVAILABLE_TEXT
}

export default async function SalesProgressPage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  const access = await requireBookingAccess(params.id, 'view')
  if (!access.ok) {
    return (
      <Shell>
        <Notice text={noticeFor(access.response.status)} />
      </Shell>
    )
  }

  let data: SalesProgressData | null = null
  try {
    data = await loadSalesProgress(supabaseAdmin, params.id, createDepartureUnitSource(supabaseAdmin))
  } catch (err) {
    console.error('[sales-progress] load failed:', err)
  }

  return (
    <Shell>
      <div className="mb-4">
        <CrmTabs clientId={params.id} active="sales" />
      </div>
      <h1 className="mb-3 text-lg font-semibold text-me-charcoal">销售进度</h1>
      {data ? <SalesProgressTable data={data} clientId={params.id} /> : <Notice text={UNAVAILABLE_TEXT} />}
    </Shell>
  )
}
