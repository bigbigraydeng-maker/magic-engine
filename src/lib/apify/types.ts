/** Apify Run Actor query parameters; omitted fields retain legacy defaults. */
export interface ApifyStartOptions {
  maxTotalChargeUsd?: number
  timeout?: number
  memory?: number
  build?: string
}

export interface ApifyRunResult {
  id: string
  status: 'READY' | 'RUNNING' | 'TIMING-OUT' | 'ABORTING' | 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT' | 'ABORTED'
  defaultDatasetId: string
  startedAt: string
  finishedAt?: string
  usageTotalUsd?: number
  buildId?: string
  buildNumber?: string
}

export interface SocialProfileData {
  platform: 'facebook' | 'instagram'
  url: string
  name: string
  followersCount: number | null
  postsCount: number | null
  bio: string | null
  isVerified: boolean
  recentPostsCount: number // posts in last 30 days (estimated)
  engagementRate: number | null // % if available
  scrapedAt: string
}

export interface MetaAdData {
  adId: string
  pageName: string
  pageUrl: string
  adText: string | null
  headline: string | null
  callToAction: string | null
  imageUrl: string | null
  startDate: string | null
  isActive: boolean
  platforms: string[] // ['facebook', 'instagram', ...]
  estimatedReach: string | null // e.g. "1K-5K"
  spendRange: string | null // e.g. "100-499 AUD"
}

export interface ApifyScrapingResult<T> {
  success: boolean
  data: T[]
  runId: string | null
  error?: string
}
