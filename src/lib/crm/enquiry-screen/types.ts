/**
 * 「邮件 / WhatsApp 来客是不是有效咨询」筛选的共用类型与常量。
 * 设计稿：docs/specs/2026-10-21-crm-valid-leads-only-design-v0.md
 *
 * 纯类型 + 常量，不碰 supabase / 网络。行业词表在 `industry/`，客户差异走 `clients.leads_config`。
 */

/** 5 类「不是咨询」（行业无关的通用类别）。 */
export const NON_ENQUIRY_CATEGORIES = [
  'solicitation', // 推销 / 合作邀请
  'bulk_marketing', // 群发营销 / 订阅
  'system_notice', // 系统通知
  'auto_reply', // 自动回复
  'protest', // 抗议 / 表态群发信（与是否买团无关）
] as const
export type NonEnquiryCategory = (typeof NON_ENQUIRY_CATEGORIES)[number]

export const NOT_ENQUIRY_STAGE_KEY = 'not_enquiry'

/**
 * 能进筛选的触点来源白名单（channel/source，且必须是入站）。
 * 来源于 CTS 生产库 2026-10-21 `select distinct channel, source`：
 * email/microsoft_mail、email/outlook、email/outlook_info_scan、whatsapp/whatsapp。
 * 其余（表单、私信、电话、Mailchimp 打开点击、email_conversation…）一律不在白名单 → 不进筛选。
 */
export const SCREENABLE_INBOUND_SOURCES: ReadonlySet<string> = new Set([
  'email/microsoft_mail',
  'email/outlook',
  'email/outlook_info_scan',
  'whatsapp/whatsapp',
])

export interface ScreenTouch {
  channel: string
  source: string | null
  direction: 'inbound' | 'outbound'
  /** 邮件/消息发出时间。 */
  occurredAt: string
  /** 入库时间（判「判走之后有没有新入站」用这个，不用 occurredAt）。 */
  createdAt: string
  subject: string | null
  /** 正文预览（库里已存的前 ~255 字）。 */
  preview: string | null
}

export interface ScreenStageEvent {
  fromStage: string | null
  toStage: string
  changedBy: string | null
  createdAt: string
}

export interface ScreenContact {
  id: string
  stage: string | null
  doNotContact: boolean
  emails: string[]
  hasPhone: boolean
}

export interface ScreenConfig {
  /** `clients.leads_config.enquiry_screen.enabled`；缺省 false。 */
  enabled: boolean
  /** 第一封信到现在至少过几天才下判，默认 2。 */
  minAgeDays: number
  /** 模型 confidence 阈值，默认 0.9。 */
  confidenceThreshold: number
}

export const DEFAULT_SCREEN_CONFIG: ScreenConfig = {
  enabled: false,
  minAgeDays: 2,
  confidenceThreshold: 0.9,
}

/** 从 `clients.leads_config` 读筛选配置；读得宽容，缺什么用默认，永不抛错。 */
export function readScreenConfig(leadsConfig: unknown): ScreenConfig {
  const root = (leadsConfig ?? {}) as Record<string, unknown>
  const raw = (root.enquiry_screen ?? {}) as Record<string, unknown>
  const days = typeof raw.min_age_days === 'number' && raw.min_age_days >= 0 ? raw.min_age_days : DEFAULT_SCREEN_CONFIG.minAgeDays
  const conf =
    typeof raw.confidence_threshold === 'number' && raw.confidence_threshold > 0 && raw.confidence_threshold <= 1
      ? raw.confidence_threshold
      : DEFAULT_SCREEN_CONFIG.confidenceThreshold
  return { enabled: raw.enabled === true, minAgeDays: days, confidenceThreshold: conf }
}

/** 为什么这个人不进筛选（写进干跑报告，也进测试）。 */
export type IneligibleReason =
  | 'disabled'
  | 'no_stage_configured'
  | 'do_not_contact'
  | 'no_touches'
  | 'non_screenable_touch'
  | 'has_outbound'
  | 'has_phone'
  | 'trade_or_staff'
  | 'human_stage_change'
  | 'no_machine_event'
  | 'stage_mismatch'
  | 'stage_not_allowed'
  | 'too_recent'
  | 'not_revived'

export type Eligibility = { eligible: true } | { eligible: false; why: IneligibleReason }

/** 判走时记在阶段事件 note 里的格式前缀（读侧用它识别）。 */
export const SCREEN_NOTE_PREFIX = '不是咨询：'
