/**
 * 成交/咨询事实的录入校验与规范化（Issue #1397 PR1）。
 *
 * 纯函数：不碰数据库、不发网络请求。路由层负责鉴权、读客户配置、写库。
 * 这样这一层的规则可以被完整测到，而不需要一个假的 Supabase。
 *
 * 这里挡住的每一条，都是"进了库之后就很难收拾"的东西：
 * 一旦行被人审核放行并发给 Meta，就撤不回（CAPI 没有删除端点）。
 */

import { normalizeEmail, normalizeName, normalizePhone } from '@/lib/pii/normalize'
import { minorUnitsFor, SUPPORTED_CURRENCIES, toMinorUnits } from './money'

export { minorUnitsFor, SUPPORTED_CURRENCIES, toMinorUnits }

/** Meta 事件语义在 L3 adapter 里映射；这一层只认业务事实。 */
export type OutcomeKind = 'purchase' | 'balance' | 'lead'

export type SourceKind =
  | 'manual_seed'
  | 'inbox_extract'
  | 'web_form'
  | 'meta_lead_form'
  | 'api'
  /** 外部 CRM 同步（PM 2026-09-05：一个月内上 HubSpot）。source_ref 存对方的交易编号。 */
  | 'crm_hubspot'
  /**
   * 读取一张人工维护的表格（Google Sheet / Excel），不是正式 CRM 系统的 API 对接。
   * 跟 `crm_hubspot` 分开：那个专留给未来接入真正的 CRM API，可信度和这个不一样，
   * 混在一起以后没法按来源筛问题记录（CTS Meta CAPI 项目，2026-09-13，待 PM 确认命名）。
   */
  | 'crm_sheet_sync'
  /**
   * 从 Facebook Messenger 私信对话文本判断出的有效咨询（NAL，2026-09-15）。
   * 跟 `crm_sheet_sync` 是姊妹枚举值：都是"规则式判断非官方 CRM 数据源"，
   * 区别只在于一个读结构化表格、一个读非结构化对话。
   */
  | 'messenger_conversation'
  /**
   * 员工在 ME 客户管理工作台里把联系人手动推进到"已成交"档位时录入（NAL，
   * 2026-09-15）。跟 `messenger_conversation` 区分开：那个是规则自动判断的咨询，
   * 这个是人已经确认过金额的成交，可信度更高，以后要按来源筛问题记录时不能混在一起。
   */
  | 'crm_stage_manual'

export const OUTCOME_KINDS: readonly OutcomeKind[] = ['purchase', 'balance', 'lead']
export const SOURCE_KINDS: readonly SourceKind[] = [
  'manual_seed',
  'inbox_extract',
  'web_form',
  'meta_lead_form',
  'api',
  'crm_hubspot',
  'crm_sheet_sync',
  'messenger_conversation',
  'crm_stage_manual',
]

/**
 * Meta 要求"这笔转化实际发生在哪个渠道"，跟"这条记录里有没有采集到某个字段"是
 * 两回事——调用方按 `sourceKind` 显式决定，不能让发送层从字段存在与否反推
 * （魏征评审：反推会把"历史上留过私信身份、但这笔其实是邮件/转账促成"的成交
 * 错误地报成私信转化）。
 */
export type ActionSource = 'email' | 'business_messaging'

const MESSENGER_SOURCED: ReadonlySet<SourceKind> = new Set(['messenger_conversation', 'crm_stage_manual'])

export function actionSourceForSourceKind(sourceKind: SourceKind): ActionSource {
  return MESSENGER_SOURCED.has(sourceKind) ? 'business_messaging' : 'email'
}

export type IntakeInput = {
  clientId: string
  contactId?: string | null
  outcomeKind: string
  customerEmail?: string | null
  customerPhone?: string | null
  customerFirst?: string | null
  customerLast?: string | null
  orderRef?: string | null
  /** 金额的**主单位**（元/刀），如 3880.5。库里存最小单位（分/仙）。 */
  amount?: number | string | null
  currency?: string | null
  /** ISO 8601。到账日 / 首次接触日 —— 不是行程出发日。 */
  occurredAt: string
  sourceKind: string
  sourceRef?: string | null
  createdBy?: string | null
  /**
   * Facebook Messenger 私信身份（page-scoped user id）。没有邮箱/电话时的第三种
   * 匹配键——Meta 官方文档要求原样传（不哈希），跟邮箱/电话的哈希处理不一样。
   */
  pageScopedUserId?: string | null
}

export type IntakeContext = {
  /** clients.default_phone_country，如 '64'。拿不到时本地格式电话不入库。 */
  defaultPhoneCountry: string | null
  /** 现在时刻，测试可注入。 */
  now: Date
}

export type IntakeRow = {
  client_id: string
  contact_id: string | null
  outcome_kind: OutcomeKind
  customer_email: string | null
  customer_phone: string | null
  customer_first: string | null
  customer_last: string | null
  order_ref: string | null
  amount_minor: number | null
  currency: string | null
  occurred_at: string
  source_kind: SourceKind
  source_ref: string | null
  created_by: string | null
  page_scoped_user_id: string | null
}

export type IntakeResult =
  | { ok: true; row: IntakeRow; warnings: string[] }
  | { ok: false; errors: string[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 未来多久之内的时间算合理。系统时钟偏差留一点余量，别把正常录入拦下来。 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

/** 超过 7 天的行照收（历史成交要留档），但提醒它发不出去。 */
const META_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function buildIntakeRow(input: IntakeInput, ctx: IntakeContext): IntakeResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!UUID_RE.test(input.clientId ?? '')) {
    errors.push('clientId 必须是 uuid')
  }
  if (input.contactId != null && input.contactId !== '' && !UUID_RE.test(input.contactId)) {
    errors.push('contactId 必须是 uuid 或留空')
  }

  const outcomeKind = input.outcomeKind as OutcomeKind
  if (!OUTCOME_KINDS.includes(outcomeKind)) {
    errors.push(`outcomeKind 必须是 ${OUTCOME_KINDS.join(' / ')}`)
  }

  const sourceKind = input.sourceKind as SourceKind
  if (!SOURCE_KINDS.includes(sourceKind)) {
    errors.push(`sourceKind 必须是 ${SOURCE_KINDS.join(' / ')}`)
  }

  // ── 时间 ────────────────────────────────────────────────────────────────
  const occurred = new Date(input.occurredAt ?? '')
  if (Number.isNaN(occurred.getTime())) {
    errors.push('occurredAt 不是合法时间')
  } else if (occurred.getTime() - ctx.now.getTime() > FUTURE_TOLERANCE_MS) {
    // 🔴 这一条挡的是真实事故形状：把**行程出发日**当成付款日录进来。
    //    CTS 有 2027 年 3 月才走的团，定金 2026 年就付了 —— 录错日期会让这笔
    //    永远发不出去（Meta 只收 7 天内的），而且没人知道为什么。
    errors.push('occurredAt 不能是未来时间 —— 这里要填「钱到账 / 客人来问」的日期，不是行程出发日')
  } else if (ctx.now.getTime() - occurred.getTime() > META_WINDOW_MS) {
    warnings.push(
      'occurredAt 已超过 7 天：Meta 只接受 7 天内的事件，这条会存档但发不出去（历史成交可留待客户名单那条腿使用）',
    )
  }

  // ── 金额 ────────────────────────────────────────────────────────────────
  const currency = input.currency ? input.currency.trim().toUpperCase() : null
  if (currency != null && !/^[A-Z]{3}$/.test(currency)) {
    errors.push('currency 必须是三字母 ISO 4217，如 NZD')
  } else if (currency != null && minorUnitsFor(currency) == null) {
    errors.push(
      `暂不支持币种 ${currency}（现支持 ${SUPPORTED_CURRENCIES.join(' / ')}）—— ` +
        '要用新币种请先在 src/lib/conversions/money.ts 里补上它的小数位，别让系统去猜',
    )
  }

  let amountMinor: number | null = null
  const hasAmount = input.amount != null && input.amount !== ''

  if (outcomeKind === 'lead') {
    if (hasAmount) {
      // PM 2026-09-05 拍板：咨询不带金额（同一区间内大同小异）。
      errors.push('lead 不带金额')
    }
    if (currency) errors.push('lead 不带币种')
  } else if (OUTCOME_KINDS.includes(outcomeKind)) {
    if (!hasAmount) errors.push(`${outcomeKind} 必须有金额`)
    if (!currency) errors.push(`${outcomeKind} 必须有币种`)
    if (hasAmount && currency) {
      const minor = toMinorUnits(input.amount as number | string, currency)
      if (minor == null) {
        if (minorUnitsFor(currency) != null) {
          errors.push('amount 不是合法金额，或小数位超出该币种精度')
        }
      } else if (minor <= 0) {
        errors.push('amount 必须大于 0（退款不走这张表）')
      } else {
        amountMinor = minor
      }
    }
  }

  // ── 匹配键 ──────────────────────────────────────────────────────────────
  const email = normalizeEmail(input.customerEmail)
  const phoneRaw = input.customerPhone?.trim() ?? ''
  const phone = normalizePhone(input.customerPhone, ctx.defaultPhoneCountry)

  if (phoneRaw.length > 0 && phone == null) {
    // 说清楚为什么丢了，否则会被当成"系统吃了我的输入"。
    warnings.push(
      ctx.defaultPhoneCountry
        ? '电话无法解析成国际格式，已忽略'
        : '该客户没有配置默认国家码，本地格式的电话无法转成国际格式，已忽略（宁可少一个匹配键，也不猜错国家）',
    )
  }

  const pageScopedUserId = input.pageScopedUserId?.trim() || null

  if (!email && !phone && !pageScopedUserId) {
    errors.push(
      '至少要有邮箱、电话、或 Facebook 私信身份之一 —— 一个都没有的话，发给 Meta 100% 匹配不上',
    )
  }

  // 🔴 魏征评审：contact_id 为空会让 writeback-service.ts 的拒联检查整段静默跳过。
  //    只靠邮箱/电话时这条风险本来就在（历史遗留），但只靠 PSID 时新开一条数据源，
  //    不能再放过这个口子——这条路径下必须强制要求 contact_id。
  const contactId = input.contactId && input.contactId !== '' ? input.contactId : null
  if (!email && !phone && pageScopedUserId && !contactId) {
    errors.push(
      '只有 Facebook 私信身份、没有邮箱电话时，contactId 必须提供——' +
        '否则发送前的「客人是否拒联」检查会被整段跳过',
    )
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    warnings,
    row: {
      client_id: input.clientId,
      contact_id: contactId,
      outcome_kind: outcomeKind,
      customer_email: email,
      customer_phone: phone,
      customer_first: normalizeName(input.customerFirst),
      customer_last: normalizeName(input.customerLast),
      order_ref: input.orderRef?.trim() || null,
      amount_minor: amountMinor,
      currency: outcomeKind === 'lead' ? null : currency,
      occurred_at: occurred.toISOString(),
      source_kind: sourceKind,
      source_ref: input.sourceRef?.trim() || null,
      created_by: input.createdBy?.trim() || null,
      page_scoped_user_id: pageScopedUserId,
    },
  }
}
