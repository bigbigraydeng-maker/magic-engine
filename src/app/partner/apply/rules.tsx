import { AI_STEWARD_RULES_V1 as RULES } from '@/lib/distributor/config'
import { formatDollars } from '@/lib/distributor/simulate'
import { PRIVACY_CONTACT_EMAIL } from '@/lib/distributor/terms'

const pct = (bp: number) => `${bp / 100}%`

export function PlanCards() {
  return (
    <section className="mt-12">
      <h2 className="text-[22px] font-bold text-me-charcoal">你卖的是什么</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-me-charcoal/60">
        按每月视频条数收费，客户可以单独加购。所有价格为新西兰元，以 Magic Engine 当时公布的为准。
      </p>
      <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {RULES.catalog.plans.map((plan) => (
          <div key={plan.code} className="rounded-2xl bg-white p-5 shadow-card">
            <div className="text-sm text-me-charcoal/60">每月 {plan.videosPerMonth} 条视频</div>
            <div className="mt-2 text-[28px] font-bold tabular-nums text-me-charcoal">
              {formatDollars(plan.monthlyCents, true)}
              <small className="ml-0.5 text-sm font-medium text-me-charcoal/55">/月</small>
            </div>
            <div className="mt-1.5 text-xs text-me-charcoal/50">
              平均每条 {formatDollars(Math.round(plan.monthlyCents / plan.videosPerMonth))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-me-charcoal/55">
        每个套餐默认含 {RULES.catalog.includedAvatars} 个数字人，每多 1 个一次性加{' '}
        {formatDollars(RULES.catalog.extraAvatarOneTimeCents, true)}。客户不管怎么买（套餐、加购、多买几个月），都按实付金额套用同一套分润规则。
      </p>
    </section>
  )
}

export function RuleCards() {
  const ref =
    RULES.catalog.plans.find((p) => p.code === 'videos-16')?.monthlyCents ??
    RULES.catalog.plans[0].monthlyCents
  const retailRows: Array<{ label: string; bp: number }> = [
    { label: '普通经销商', bp: RULES.retailRateBp.standard },
    { label: '一级经销商', bp: RULES.retailRateBp.tier1 },
    { label: '特级经销商', bp: RULES.retailRateBp.premier },
  ]
  return (
    <section className="mt-12">
      <h2 className="text-[22px] font-bold text-me-charcoal">分润规则，三件事</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-me-charcoal/60">
        全部按「客户实付金额」计算，客户付款满 {RULES.refundWindowDays} 天后进入月结。
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-white p-6 shadow-card">
          <span className="inline-block rounded-full bg-me-ochre px-2.5 py-[3px] text-xs font-bold text-white">
            ① 零售分润
          </span>
          <h3 className="mt-3 text-lg font-bold text-me-charcoal">你卖出的每一单</h3>
          <p className="mt-2 text-sm leading-relaxed text-me-charcoal/70">
            按你当时的等级拿比例。你自己购买也算，但必须是你自己真实使用的服务。
          </p>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-black/[0.06] py-2 text-left text-xs font-semibold text-me-charcoal/50">等级</th>
                <th className="border-b border-black/[0.06] py-2 text-right text-xs font-semibold text-me-charcoal/50">零售比例</th>
                <th className="border-b border-black/[0.06] py-2 text-right text-xs font-semibold text-me-charcoal/50">
                  卖一单 {formatDollars(ref, true)} 拿
                </th>
              </tr>
            </thead>
            <tbody>
              {retailRows.map((row) => (
                <tr key={row.label}>
                  <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal">{row.label}</td>
                  <td className="border-b border-black/[0.06] py-2 text-right font-bold tabular-nums text-me-ochre">{pct(row.bp)}</td>
                  <td className="border-b border-black/[0.06] py-2 text-right tabular-nums text-me-charcoal">
                    {formatDollars(Math.floor((ref * row.bp) / 10000))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-card">
          <span className="inline-block rounded-full bg-me-ochre px-2.5 py-[3px] text-xs font-bold text-white">
            ② 平级奖励
          </span>
          <h3 className="mt-3 text-lg font-bold text-me-charcoal">下面的人和你同级时</h3>
          <p className="mt-2 text-sm leading-relaxed text-me-charcoal/70">
            你下面的经销商卖出一单，往上找到的第一个和他同等级的人，拿这单实付金额的 {pct(RULES.peerRateBp)}，只给一个人。
          </p>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-black/[0.06] py-2 text-left text-xs font-semibold text-me-charcoal/50">例子</th>
                <th className="border-b border-black/[0.06] py-2 text-right text-xs font-semibold text-me-charcoal/50">你拿</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal">
                  你是普通，下面的普通经销商卖一单 {formatDollars(ref, true)}
                </td>
                <td className="border-b border-black/[0.06] py-2 text-right font-bold tabular-nums text-me-ochre">
                  {formatDollars(Math.floor((ref * RULES.peerRateBp) / 10000))}
                </td>
              </tr>
              <tr>
                <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal">你是一级，下面的普通经销商卖一单</td>
                <td className="border-b border-black/[0.06] py-2 text-right tabular-nums text-me-charcoal">不发（等级不同）</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-card">
          <span className="inline-block rounded-full bg-me-ochre px-2.5 py-[3px] text-xs font-bold text-white">
            ③ 团队奖励
          </span>
          <h3 className="mt-3 text-lg font-bold text-me-charcoal">你和你下面所有人，每次月结的销售合计</h3>
          <p className="mt-2 text-sm leading-relaxed text-me-charcoal/70">
            每次月结时计算一次，算的是这次月结里结算的单——客户付款满 {RULES.refundWindowDays} 天才进月结，所以月底卖的单会算进下一次。合计越多比例越高，再减掉你下面各级经销商按各自比例应得的团队奖励（阶梯差额）。月结前{' '}
            {RULES.teamInactivityDays} 天里你自己一单都没卖，这次团队奖励不发，之后也不补发。
          </p>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-black/[0.06] py-2 text-left text-xs font-semibold text-me-charcoal/50">每次月结的团队合计</th>
                <th className="border-b border-black/[0.06] py-2 text-right text-xs font-semibold text-me-charcoal/50">团队比例</th>
              </tr>
            </thead>
            <tbody>
              {RULES.teamRateSteps.map((step) => (
                <tr key={step.minTeamSalesCents}>
                  <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal">
                    {formatDollars(step.minTeamSalesCents, true)} 起
                  </td>
                  <td className="border-b border-black/[0.06] py-2 text-right font-bold tabular-nums text-me-ochre">{pct(step.rateBp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-card">
          <span className="inline-block rounded-full bg-me-ochre px-2.5 py-[3px] text-xs font-bold text-white">怎么升级</span>
          <h3 className="mt-3 text-lg font-bold text-me-charcoal">普通 → 一级 → 特级</h3>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-black/[0.06] py-2 text-left text-xs font-semibold text-me-charcoal/50">升到</th>
                <th className="border-b border-black/[0.06] py-2 text-left text-xs font-semibold text-me-charcoal/50">条件（满足一项即可）</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal">一级</td>
                <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal">
                  你自己一次购买满 {formatDollars(RULES.upgrade.tier1SingleSelfPurchaseCents, true)}
                </td>
              </tr>
              <tr>
                <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal" />
                <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal">
                  或累计卖给客户满 {formatDollars(RULES.upgrade.tier1CumulativeDirectSalesCents, true)}
                </td>
              </tr>
              <tr>
                <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal">特级</td>
                <td className="border-b border-black/[0.06] py-2 text-left text-me-charcoal">
                  团队连续 {RULES.upgrade.premierConsecutiveMonths} 个月每月满{' '}
                  {formatDollars(RULES.upgrade.premierMonthlyTeamSalesCents, true)}，且直属里至少{' '}
                  {RULES.upgrade.premierMinDirectTier1} 位一级
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-sm leading-relaxed text-me-charcoal/70">
            只算付款满 {RULES.refundWindowDays} 天的单，金额按扣除退款后计算。没有任何必须购买的东西，只靠卖给客户也能升级。
          </p>
        </div>
      </div>
    </section>
  )
}

export function SettlementCards() {
  return (
    <section className="mt-12">
      <h2 className="text-[22px] font-bold text-me-charcoal">结算、退款和你要遵守的</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-white p-6 shadow-card">
          <h3 className="text-lg font-bold text-me-charcoal">结算和退款</h3>
          <ul className="mt-2.5 list-none">
            <li className="relative py-1.5 pl-[18px] text-sm leading-relaxed text-me-charcoal/70 before:absolute before:left-0.5 before:top-[15px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-me-ochre">
              每月 1 日结算上一个月，Magic Engine 核对后再付款。
            </li>
            <li className="relative py-1.5 pl-[18px] text-sm leading-relaxed text-me-charcoal/70 before:absolute before:left-0.5 before:top-[15px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-me-ochre">
              客户付款满 {RULES.refundWindowDays} 天后，这笔销售才进入月结。之后客户退款的，已发的分润扣回；当月不够扣的，从之后月份扣。
            </li>
            <li className="relative py-1.5 pl-[18px] text-sm leading-relaxed text-me-charcoal/70 before:absolute before:left-0.5 before:top-[15px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-me-ochre">
              我们不保证任何收入，你能拿多少完全取决于实际卖出多少。
            </li>
            <li className="relative py-1.5 pl-[18px] text-sm leading-relaxed text-me-charcoal/70 before:absolute before:left-0.5 before:top-[15px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-me-ochre">
              以上规则以你申请时这个页面为准；Magic Engine 调整规则时会更新这个页面。
            </li>
          </ul>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-card">
          <h3 className="text-lg font-bold text-me-charcoal">你要遵守的</h3>
          <ul className="mt-2.5 list-none">
            <li className="relative py-1.5 pl-[18px] text-sm leading-relaxed text-me-charcoal/70 before:absolute before:left-0.5 before:top-[15px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-me-ochre">
              只介绍 Magic Engine 真实提供的服务和价格，不夸大效果，不向客户承诺结果。
            </li>
            <li className="relative py-1.5 pl-[18px] text-sm leading-relaxed text-me-charcoal/70 before:absolute before:left-0.5 before:top-[15px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-me-ochre">
              不冒充 Magic Engine 员工，不以 Magic Engine 名义签协议或收款。
            </li>
            <li className="relative py-1.5 pl-[18px] text-sm leading-relaxed text-me-charcoal/70 before:absolute before:left-0.5 before:top-[15px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-me-ochre">
              我们会逐份审核申请，可能不通过。新加入的经销商都从普通开始。
            </li>
            <li className="relative py-1.5 pl-[18px] text-sm leading-relaxed text-me-charcoal/70 before:absolute before:left-0.5 before:top-[15px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-me-ochre">
              违反以上几条可以被停用；停用期间的收益只记账、不发放，恢复后也不补发。
            </li>
            <li className="relative py-1.5 pl-[18px] text-sm leading-relaxed text-me-charcoal/70 before:absolute before:left-0.5 before:top-[15px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-me-ochre">
              你填的信息只用来审核和联系你，不交给任何第三方。查看或删除请发邮件到 {PRIVACY_CONTACT_EMAIL}。
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}
