export type PackageKey = 'starter_29' | 'growth_79' | 'scale_199' | 'bonus_100'
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
  | 'reels_video'
  | 'social_post'
  | 'social_series'
  | 'social_calendar'
  | 'marketing_plan'
  | 'keyword_report'
  | 'geo_directives'
  | 'ai_tracker_report'
  | 'competitor_report'
  | 'master_brief_update'
  | 'bonus_registration'

export const MTC_RATES: Record<ServiceKey, number> = {
  blog_seo: 40,
  blog_dual_signal: 60,
  image_single: 10,
  image_pack_4: 30,
  image_pack_12: 70,
  reels_storyboard: 5,
  reels_video: 80,
  social_post: 5,
  social_series: 20,
  social_calendar: 30,
  marketing_plan: 30,
  keyword_report: 30,
  geo_directives: 20,
  ai_tracker_report: 40,
  competitor_report: 40,
  master_brief_update: 20,
  bonus_registration: 100,
}

export interface MtcPackage {
  key: PackageKey
  amountNzd: number
  mtcAmount: number
  label: string
}

export const MTC_PACKAGES: MtcPackage[] = [
  { key: 'starter_29', amountNzd: 29, mtcAmount: 300, label: 'Starter — 300 MTC' },
  { key: 'growth_79', amountNzd: 79, mtcAmount: 1200, label: 'Growth — 1,200 MTC' },
  { key: 'scale_199', amountNzd: 199, mtcAmount: 3500, label: 'Scale — 3,500 MTC' },
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
