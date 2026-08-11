/**
 * 一套房的详情页 —— 目前主体就是「档案」。
 *
 * 为什么单独开一页而不是塞进列表里展开:档案有版本、有草稿和生效两种状态、
 * 有十几栏要逐条改,塞进一行表格里没法用。列表回答「有哪些房」,这一页回答
 * 「这套房我们怎么打」。
 *
 * 服务端只做鉴权和外壳,取数和交互在 ListingBriefClient 里。
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireListingAccess } from '@/lib/listings/queries'
import { propertyTypeLabel, priceBandLabel, listingStatusLabel } from '@/lib/listings/constants'
import { ListingBriefClient } from './_components/ListingBriefClient'
import { ListingAssetsPanel } from './_components/ListingAssetsPanel'

export const dynamic = 'force-dynamic'

export default async function ListingDetailPage({
  params,
}: {
  params: { id: string; listingId: string }
}) {
  const access = await requireListingAccess(params.listingId)
  if (!access.ok) {
    return (
      <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-black text-[#C2453A]">无权访问</p>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{access.error}</p>
        </div>
      </div>
    )
  }

  // 网址里的客户和这套房实际归属的客户必须对得上 —— 鉴权已经过了(按房子真正的
  // 归属判的),这一步只是防止从 A 客户的地址栏打开 B 客户的房子,让面包屑
  // 和「返回」指到一个跟内容不符的地方。
  if (access.row.client_id !== params.id) notFound()

  const l = access.row

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">
      <div className="mb-6">
        <Link
          href={`/dashboard/clients/${params.id}/listings`}
          className="text-xs font-bold text-me-charcoal/45 hover:text-me-ochre"
        >
          ← 返回房子列表
        </Link>
        <h1 className="mt-1 font-display text-2xl font-black text-me-charcoal">{l.address_line}</h1>
        <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
          {[l.suburb, l.city].filter(Boolean).join(' · ') || '没填郊区'}
          {' — '}
          {listingStatusLabel(l.status)} · {priceBandLabel(l.price_band)} · {propertyTypeLabel(l.property_type)}
          {l.bedrooms != null && ` · ${l.bedrooms} 房`}
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-black/10 bg-white p-4">
        <h2 className="font-display text-lg font-black text-me-charcoal">档案</h2>
        <p className="mt-1 max-w-2xl text-sm font-semibold text-me-charcoal/55">
          AI 先做功课出草稿，你逐栏校正，确认后点生效。每一栏旁边都标着这条信息是
          <strong>查到的</strong>、<strong>AI 判断的</strong>，还是<strong>缺的</strong> ——
          别把 AI 猜的当成查到的拿去跟卖家谈。
        </p>
        <p className="mt-2 text-xs font-semibold text-me-charcoal/40">
          跑完之后把实际结果填回来那一步，下一批做。字段已经留好了。
        </p>
      </div>

      <ListingBriefClient listingId={params.listingId} />

      {/* 素材放在档案下面：先定「这套房怎么打」，再看「有没有能打的画面」。 */}
      <div className="mt-8">
        <ListingAssetsPanel clientId={params.id} listingId={params.listingId} />
      </div>
    </div>
  )
}
