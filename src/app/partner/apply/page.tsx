import type { Metadata } from 'next'
import { AI_STEWARD_RULES_V1 as RULES } from '@/lib/distributor/config'
import { normaliseReferralCode } from '@/lib/distributor/referral-code'
import { DISTRIBUTOR_TERMS_VERSION, distributorTerms } from '@/lib/distributor/terms'
import { ApplyForm } from './apply-form'

export const metadata: Metadata = { title: '申请成为经销商 · Magic Engine' }

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-NZ')}`

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const { ref } = await searchParams
  const referralCode = normaliseReferralCode(Array.isArray(ref) ? ref[0] : ref)

  return (
    <main className="min-h-screen bg-me-ivory px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold text-me-charcoal/90">成为 Magic Engine 经销商</h1>
        <p className="mt-3 text-sm text-me-charcoal/75">
          向身边的商家推荐 AI 数字人管家：帮他们写视频脚本、生成视频内容、发布到社交媒体、拉回数据看效果。客户付费，你按实付金额拿分润。加入免费。
        </p>

        <div className="mt-8 overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="border-b border-black/[0.06] px-6 py-4">
            <h2 className="text-base font-bold text-me-charcoal/90">现在的价格</h2>
          </div>
          <div className="px-6 py-5">
            <ul className="divide-y divide-black/[0.06]">
              {RULES.catalog.plans.map((plan) => (
                <li key={plan.code} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-me-charcoal/75">每月 {plan.videosPerMonth} 条视频</span>
                  <span className="font-bold tabular-nums text-me-charcoal/90">{dollars(plan.monthlyCents)}/月</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-me-charcoal/55">
              每个套餐默认含 {RULES.catalog.includedAvatars} 个数字人，每多 1 个一次性加 $
              {RULES.catalog.extraAvatarOneTimeCents / 100}。价格以 Magic Engine 当时公布的为准，单位新西兰元。
            </p>
          </div>
        </div>

        <div className="mt-8">
          <ApplyForm
            terms={distributorTerms()}
            termsVersion={DISTRIBUTOR_TERMS_VERSION}
            initialReferralCode={referralCode}
          />
        </div>

        <p className="mt-10 text-center text-xs text-me-charcoal/45">Magic Engine · 新西兰</p>
      </div>
    </main>
  )
}
