import type { Metadata } from 'next'
import Link from 'next/link'
import { normaliseReferralCode } from '@/lib/distributor/referral-code'
import { NO_OWN_SALES_EXAMPLE, SIMULATION_EXAMPLES, formatDollars, simulateMonth } from '@/lib/distributor/simulate'
import { DISTRIBUTOR_TERMS_VERSION } from '@/lib/distributor/terms'
import { ApplyForm } from './apply-form'
import { PlanCards, RuleCards, SettlementCards } from './rules'
import { Simulator } from './simulator'

export const metadata: Metadata = { title: '申请成为经销商 · Magic Engine' }

const CHIPS = ['加入免费', '只按真实付款分钱', '拉人本身没有奖励', '每月 1 日结算']

/** Worked examples, computed with the same engine as the monthly settlement. */
function Examples() {
  const warn = simulateMonth(NO_OWN_SALES_EXAMPLE)
  return (
    <>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {SIMULATION_EXAMPLES.map((ex) => {
          const result = simulateMonth(ex.input)
          return (
            <div key={ex.title} className="rounded-2xl bg-white p-5 shadow-card">
              <div className="text-sm font-bold text-me-charcoal">{ex.title}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-me-charcoal/60">
                {ex.description}（{formatDollars(result.planMonthlyCents, true)} 套餐）
              </p>
              <div className="mt-3 text-2xl font-bold tabular-nums text-me-ochre">
                {formatDollars(result.totalCents)}
                <small className="ml-1 text-[13px] font-medium text-me-charcoal/50">/月</small>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-4 rounded-xl bg-[#F2EEE7] px-4 py-3.5 text-[13px] leading-relaxed text-me-charcoal/65">
        提醒：自己一单都不卖、只带团队，团队奖励不发。比如普通经销商自己 0 单、带 {NO_OWN_SALES_EXAMPLE.directCount} 人每人{' '}
        {NO_OWN_SALES_EXAMPLE.salesEach} 单，只能拿到平级奖励 {formatDollars(warn.peerCents)}，团队奖励{' '}
        {formatDollars(warn.teamWithheldCents)} 不发放，之后也不补发。
      </p>
    </>
  )
}

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const { ref } = await searchParams
  const referralCode = normaliseReferralCode(Array.isArray(ref) ? ref[0] : ref)

  return (
    <main className="min-h-screen bg-me-ivory px-4 py-8 md:py-16">
      <div className="mx-auto max-w-5xl">
        <div className="text-[13px] font-bold tracking-[0.08em] text-me-ochre">MAGIC ENGINE 经销商计划</div>
        <h1 className="mt-2 font-display text-[30px] font-bold leading-tight text-me-charcoal md:mt-3 md:text-[44px]">
          推荐 AI 数字人管家，<br className="hidden md:block" />
          按客户真实付款拿分润
        </h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-me-charcoal/70 md:mt-4 md:text-lg">
          帮身边的商家写视频脚本、生成视频、发布到社交媒体、拉回数据看效果。客户付费，你按实付金额拿分润。加入免费，不囤货，不保证收入——卖多少拿多少。
        </p>
        <Link
          href={referralCode ? `/ai-steward?ref=${referralCode}` : '/ai-steward'}
          className="mt-4 inline-block text-[15px] font-semibold text-me-ochre underline underline-offset-4"
        >
          先看看客户会看到的产品介绍 →
        </Link>
        <div className="mt-5 flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <span key={c} className="rounded-full bg-me-ochre/12 px-3 py-1.5 text-[13px] font-semibold text-me-charcoal">
              {c}
            </span>
          ))}
        </div>

        <PlanCards />
        <RuleCards />
        <Simulator />
        <Examples />
        <SettlementCards />

        <section className="mt-12">
          <h2 className="mb-5 text-[22px] font-bold text-me-charcoal">填写申请</h2>
          <ApplyForm termsVersion={DISTRIBUTOR_TERMS_VERSION} initialReferralCode={referralCode} />
        </section>

        <p className="mt-12 text-center text-xs text-me-charcoal/45">Magic Engine · 新西兰</p>
      </div>
    </main>
  )
}
