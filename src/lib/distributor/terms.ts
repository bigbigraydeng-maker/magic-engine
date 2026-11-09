/**
 * What an applicant agrees to on the public application page. Pure (safe to import in client code).
 * The money figures are read from the rule set, so the page can never promise a rate the engine
 * does not pay. Changing any wording means a new TERMS_VERSION: each application stores the version
 * the applicant actually saw.
 */
import { AI_STEWARD_RULES_V1 as RULES } from './config'

export const DISTRIBUTOR_TERMS_VERSION = 'distributor-terms-2026-11-10'

const pct = (bp: number) => `${bp / 100}%`
const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`

export const PRIVACY_CONTACT_EMAIL = 'hello@magicengine.cloud'

export interface TermsSection {
  title: string
  points: string[]
}

export function distributorTerms(): TermsSection[] {
  const steps = RULES.teamRateSteps
  const first = steps[0]
  const last = steps[steps.length - 1]
  return [
    {
      title: '怎么赚钱',
      points: [
        '加入免费：不收加盟费、押金、培训费，也不要求你先进货或囤货。',
        '收入只来自真实付费购买的服务。介绍别人加入本身不产生任何奖励。你自己购买服务也按同样比例拿零售分润，但买的必须是你自己真实使用的服务。',
        `零售分润按实付金额（新西兰元）计算：普通经销商 ${pct(RULES.retailRateBp.standard)}，一级 ${pct(RULES.retailRateBp.tier1)}，特级 ${pct(RULES.retailRateBp.premier)}。`,
        `平级奖励：你下面的经销商卖出一单，往上找到的第一个和卖家同等级的人，拿这单实付金额的 ${pct(RULES.peerRateBp)}，只给一个人。`,
        `团队奖励：按每次月结算一次——你和你下面所有经销商在这次月结里结算的销售（付款满 ${RULES.refundWindowDays} 天的单）合计到 ${dollars(first.minTeamSalesCents)} 起算 ${pct(first.rateBp)}，越多比例越高，最高到 ${dollars(last.minTeamSalesCents)} 对应 ${pct(last.rateBp)}；要先减掉你下面各级经销商按各自比例应得的团队奖励（他们因停用等原因没领到的部分也照减）。`,
        `连续 ${RULES.teamInactivityDays} 天自己没有卖出任何服务的经销商，这段时间不发团队奖励。`,
      ],
    },
    {
      title: '怎么升级',
      points: [
        `升一级经销商（任一项）：你自己一次购买满 ${dollars(RULES.upgrade.tier1SingleSelfPurchaseCents)} 的服务，或累计卖给客户满 ${dollars(RULES.upgrade.tier1CumulativeDirectSalesCents)}。只算付款满 ${RULES.refundWindowDays} 天的单，金额按扣除退款后计算。`,
        `升特级经销商：团队连续 ${RULES.upgrade.premierConsecutiveMonths} 个月每月结算销售满 ${dollars(RULES.upgrade.premierMonthlyTeamSalesCents)}，并且直属下级里至少有 ${RULES.upgrade.premierMinDirectTier1} 位一级经销商。`,
        '没有任何必须购买的东西：不买也可以只靠卖给客户升级。',
      ],
    },
    {
      title: '结算和退款',
      points: [
        '每月 1 日结算上一个月，Magic Engine 核对后再付款。',
        `客户付款满 ${RULES.refundWindowDays} 天后，这笔销售才进入月结。之后客户退款的，已经发过的分润会扣回；当月不够扣的，从之后的月份里扣。`,
        '我们不保证任何收入。你能拿多少，完全取决于你实际卖出多少。',
      ],
    },
    {
      title: '你要遵守的',
      points: [
        '只介绍 Magic Engine 真实提供的服务和价格，不夸大效果，不向客户承诺结果。',
        '不冒充 Magic Engine 员工，不以 Magic Engine 名义签任何协议或收款。',
        '我们会逐份审核申请，可能不通过；已通过的经销商违反上面几条，可以被停用。停用期间的收益只记账、不发放，恢复后也不补发。',
        '以上金额都是新西兰元。',
      ],
    },
    {
      title: '你的个人信息',
      points: [
        '你填的名字、邮箱、电话、所在城市和留言，只用来审核申请和联系你，不卖给、不交给任何第三方。',
        `想查看、修改或删除这些信息，发邮件到 ${PRIVACY_CONTACT_EMAIL}。`,
      ],
    },
  ]
}
