/**
 * 待确认的电话 —— 电话系统收了通话、但没能自动记进客人档案的那几通。
 *
 * 服务端页：先鉴权（付费客户或 ME 管理员，自助免费档不行），再取数。
 * 只读：这一页不改任何数据；「已处理」按钮另走（要电话系统那边同意）。
 * 读失败显示「暂时打不开」，绝不显示成「没有待确认」。
 */

import Link from 'next/link'
import type { ReactNode } from 'react'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadReviewCalls, type ReviewCall, type ReviewCallsResult } from '@/lib/telephony/review-calls'

export const dynamic = 'force-dynamic'

const NO_ACCESS_TEXT = '你的账号没有查看这一页的权限。'
const UNAVAILABLE_TEXT = '这一页暂时打不开，请稍后再试；如果一直这样，请告诉 Magic Engine。'
const HOW_TO_TEXT =
  '怎么处理：在「全部客人」里按电话尾号搜，找到是谁，就在他的档案里记一笔；找不到就新建一位客人再记。' +
  '「已处理」按钮还没上线，所以这几通在页面上会一直显示，直到电话系统把它们的状态改掉。'

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">{children}</div>
}

function Notice({ text }: { text: string }): JSX.Element {
  return <p className="rounded border border-me-charcoal/20 bg-me-ivory p-4 text-sm text-me-charcoal">{text}</p>
}

const NZ_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Pacific/Auckland',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function directionText(d: ReviewCall['direction']): string {
  if (d === 'inbound') return '客人打进来'
  if (d === 'outbound') return '我们打出去'
  return '方向不明'
}

function answeredText(c: ReviewCall): string {
  if (c.answered) return c.talkSeconds > 0 ? `接通，聊了 ${c.talkSeconds} 秒` : '接通'
  return '没接通'
}

function Row({ call }: { call: ReviewCall }): JSX.Element {
  return (
    <tr className="border-t border-me-charcoal/10 align-top">
      <td className="py-2 pr-3 whitespace-nowrap">{NZ_TIME.format(new Date(call.startedAt))}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{directionText(call.direction)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{call.numberTail ? `尾号 ${call.numberTail}` : '号码认不出'}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{answeredText(call)}</td>
      <td className="py-2">
        {call.status === 'failed' ? '没记成：' : '待确认：'}
        {call.reason}
      </td>
    </tr>
  )
}

function ReviewTable({ result }: { result: ReviewCallsResult }): JSX.Element {
  if (result.total === 0) {
    return <Notice text="现在没有待确认的电话。" />
  }
  return (
    <>
      <p className="mb-3 text-sm text-me-charcoal">
        共 {result.total} 通待确认{result.total > result.calls.length ? `（下面只列最近 ${result.calls.length} 通）` : ''}。
      </p>
      <p className="mb-4 text-sm text-me-charcoal/80">{HOW_TO_TEXT}</p>
      <table className="w-full text-left text-sm text-me-charcoal">
        <thead>
          <tr className="text-xs text-me-charcoal/60">
            <th className="pb-2 pr-3 font-normal">时间（新西兰）</th>
            <th className="pb-2 pr-3 font-normal">方向</th>
            <th className="pb-2 pr-3 font-normal">号码</th>
            <th className="pb-2 pr-3 font-normal">接通情况</th>
            <th className="pb-2 font-normal">为什么待确认</th>
          </tr>
        </thead>
        <tbody>
          {result.calls.map((c) => (
            <Row key={c.id} call={c} />
          ))}
        </tbody>
      </table>
    </>
  )
}

export default async function PhoneReviewPage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return (
      <Shell>
        <Notice text={access.status === 401 || access.status === 403 ? NO_ACCESS_TEXT : UNAVAILABLE_TEXT} />
      </Shell>
    )
  }

  let result: ReviewCallsResult | null = null
  try {
    result = await loadReviewCalls(supabaseAdmin, params.id)
  } catch (err) {
    console.error('[phone-review] load failed:', err)
  }

  return (
    <Shell>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-me-charcoal">待确认的电话</h1>
        <Link href={`/dashboard/clients/${params.id}/crm/all`} className="text-sm underline">
          回到全部客人
        </Link>
      </div>
      {result ? <ReviewTable result={result} /> : <Notice text={UNAVAILABLE_TEXT} />}
    </Shell>
  )
}
