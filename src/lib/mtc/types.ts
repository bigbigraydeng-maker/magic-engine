export type PackageKey = 'starter_99' | 'growth_249' | 'scale_599' | 'bonus_500'
export type MtcDirection = 'debit' | 'credit'
export type MtcSource = 'auto' | 'manual' | 'refund' | 'bonus'
export type PurchaseStatus = 'pending' | 'completed' | 'refunded' | 'expired'

export type ServiceKey =
  | 'blog_seo'
  | 'blog_dual_signal'
  | 'image_single'
  | 'image_pack_4'
  | 'image_pack_12'
  | 'reels_storyboard'
  | 'reels_480p_6s'
  | 'reels_720p_6s'
  | 'reels_720p_10s'
  | 'reels_720p_15s'
  | 'social_post'
  | 'social_series'
  | 'social_calendar'
  | 'social_story'
  | 'marketing_plan'
  | 'keyword_report'
  | 'geo_directives'
  | 'ai_tracker_report'
  | 'competitor_report'
  | 'master_brief_update'
  | 'bonus_registration'
  | 'ai_factory_post'
  | 'zhangqian_discover'

export const MTC_RATES: Record<ServiceKey, number> = {
  blog_seo: 40,
  blog_dual_signal: 60,
  image_single: 10,
  image_pack_4: 30,
  image_pack_12: 70,
  reels_storyboard: 5,
  // Reels video: priced by resolution × duration (1080p is FDE-only, not listed here)
  reels_480p_6s: 20,
  reels_720p_6s: 30,
  reels_720p_10s: 50,
  reels_720p_15s: 80,
  social_post: 5,
  social_series: 20,
  social_calendar: 30,
  social_story: 3,
  marketing_plan: 30,
  keyword_report: 30,
  geo_directives: 20,
  ai_tracker_report: 40,
  competitor_report: 40,
  master_brief_update: 20,
  bonus_registration: 100,
  ai_factory_post: 5,   // P21.8 — AI Factory 量产帖子，与 social_post 同价
  zhangqian_discover: 60, // Phase X.S2 — 张骞 discovery report regeneration; ~$0.57 real cost
}

export interface MtcPackage {
  key: PackageKey
  amountNzd: number
  mtcAmount: number
  label: string
}

export const MTC_PACKAGES: MtcPackage[] = [
  { key: 'starter_99',  amountNzd: 99,  mtcAmount: 1000, label: 'Starter — 1,000 MTC' },
  { key: 'growth_249',  amountNzd: 249, mtcAmount: 2800, label: 'Growth — 2,800 MTC' },
  { key: 'scale_599',   amountNzd: 599, mtcAmount: 7500, label: 'Scale — 7,500 MTC' },
]

export interface MtcBalanceResult {
  balance: number
  batches: Array<{
    purchaseId: string
    remaining: number
    expiresAt: string
  }>
}

export type DeductResult =
  | { ok: true; ledgerEntryId: string }
  | { ok: false; reason: 'insufficient_balance' | 'db_error'; balance?: number }

// P21.6 — monthly MTC spend cap (used by budget-guard.ts)
export const DEFAULT_MONTHLY_MTC_CAP = 5000

export interface BudgetStatus {
  allowed: boolean
  spent: number
  cap: number
  remaining: number
  capIsCustom: boolean
}
