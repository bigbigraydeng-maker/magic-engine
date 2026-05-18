import type { SupabaseClient } from '@supabase/supabase-js'
import {
  scrapeInstagramProfile,
  scrapeFacebookPage,
  scrapeTiktokProfile,
} from '@/lib/apify/social-scraper'
import type { SocialPostSample } from '@/lib/apify/social-scraper'
import type { CollectorResult, NewFinding } from '../types'
import { makeEvidence, evidenceSource } from '../types'
import { MAX_COLLECTOR_TIMEOUT_MS, SOCIAL_CACHE_TTL_DAYS } from '../constants'

// P8.10.S2.6: profile-URL helpers so social findings carry auditable sources.
function instagramSources(handle: string | null): ReturnType<typeof evidenceSource>[] {
  return handle ? [evidenceSource(`https://instagram.com/${handle.replace(/^@/, '')}`)] : []
}
function facebookSources(url: string | null): ReturnType<typeof evidenceSource>[] {
  return url ? [evidenceSource(url)] : []
}
function tiktokSources(handle: string | null): ReturnType<typeof evidenceSource>[] {
  return handle ? [evidenceSource(`https://www.tiktok.com/@${handle.replace(/^@/, '')}`)] : []
}
function sourcesForPlatform(
  platform: 'Instagram' | 'Facebook' | 'TikTok',
  handles: { instagramHandle: string | null; facebookPageUrl: string | null; tiktokHandle: string | null },
): ReturnType<typeof evidenceSource>[] {
  if (platform === 'Instagram') return instagramSources(handles.instagramHandle)
  if (platform === 'Facebook') return facebookSources(handles.facebookPageUrl)
  return tiktokSources(handles.tiktokHandle)
}

// P8.10.S2.3: extended return shape — samples flow to Synthesis layer (S3)
export interface SocialCollectorResult extends CollectorResult {
  post_samples: SocialPostSample[]
}

// ─── Scoring constants ────────────────────────────────────────────────────────
// FREQ + ENGAGE intentionally sum to 0.80, not 1.0.
// The remaining 20 points come from the multi-platform diversity bonus
// (+10 per extra platform, max +20), so a fully-configured 3-platform
// client with ideal metrics can still reach 100.
const FREQ_WEIGHT    = 0.40
const ENGAGE_WEIGHT  = 0.40
const DIVERSITY_BONUS_PER_PLATFORM = 10   // +10 pts per extra platform (max 20)

const LOW_ENGAGE_THRESHOLD = 0.005
const HIGH_POST_THRESHOLD  = 12
const LOW_POST_HIGH        = 4

// ─── Client social handles shape ─────────────────────────────────────────────
interface SocialHandles {
  instagramHandle: string | null
  facebookPageUrl: string | null
  tiktokHandle:    string | null
}

// ─── SocialCollector ─────────────────────────────────────────────────────────
export class SocialCollector {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly timeoutMs: number = MAX_COLLECTOR_TIMEOUT_MS,
  ) {}

  async collect(
    clientId: string,
    _domain: string,
    _keywords: string[],
  ): Promise<SocialCollectorResult> {
    try {
      if (await this.hasFreshCache(clientId)) return { score: null, findings: [], post_samples: [] }

      const handles = await this.fetchSocialHandles(clientId)
      const configured = [
        handles.instagramHandle,
        handles.facebookPageUrl,
        handles.tiktokHandle,
      ].filter(Boolean)

      if (configured.length === 0) {
        return { score: null, findings: [this.makeMissingPresenceFinding(clientId)], post_samples: [] }
      }

      const timeout = new Promise<SocialCollectorResult>(resolve =>
        setTimeout(() => resolve({ score: null, findings: [], post_samples: [] }), this.timeoutMs),
      )

      return await Promise.race([this.collectAndScore(clientId, handles), timeout])
    } catch {
      return { score: null, findings: [], post_samples: [] }
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async fetchSocialHandles(clientId: string): Promise<SocialHandles> {
    const { data } = await this.supabase
      .from('clients')
      .select('instagram_handle, facebook_page_url, tiktok_handle')
      .eq('id', clientId)
      .single()

    const row = data as {
      instagram_handle: string | null
      facebook_page_url: string | null
      tiktok_handle: string | null
    } | null

    return {
      instagramHandle: row?.instagram_handle ?? null,
      facebookPageUrl: row?.facebook_page_url ?? null,
      tiktokHandle:    row?.tiktok_handle ?? null,
    }
  }

  private async collectAndScore(
    clientId: string,
    handles: SocialHandles,
  ): Promise<SocialCollectorResult> {
    const platformScores: number[] = []
    const findings: NewFinding[] = []
    const post_samples: SocialPostSample[] = []

    // Run configured platforms concurrently; each is fault-tolerant
    const jobs = await Promise.allSettled([
      handles.instagramHandle
        ? scrapeInstagramProfile(handles.instagramHandle).then(p => ({
            platform: 'Instagram' as const,
            posts: p.postsLast30Days,
            engagementRate: p.engagementRate,
            topPosts: p.topPosts30d,
          }))
        : Promise.resolve(null),
      handles.facebookPageUrl
        ? scrapeFacebookPage(handles.facebookPageUrl).then(p => ({
            platform: 'Facebook' as const,
            posts: p.postsLast30Days,
            engagementRate: p.engagementRate,
            topPosts: p.topPosts30d,
          }))
        : Promise.resolve(null),
      handles.tiktokHandle
        ? scrapeTiktokProfile(handles.tiktokHandle).then(p => ({
            platform: 'TikTok' as const,
            posts: p.postsLast30Days,
            engagementRate: p.engagementRate,
            topPosts: p.topPosts30d,
          }))
        : Promise.resolve(null),
    ])

    for (const result of jobs) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const { platform, posts, engagementRate, topPosts } = result.value

      post_samples.push(...topPosts)

      const freqScore   = this.postFrequencyScore(posts)
      const engageScore = this.engagementScore(engagementRate)
      const pScore      = Math.round(freqScore * FREQ_WEIGHT + engageScore * ENGAGE_WEIGHT)
      platformScores.push(pScore)

      if (posts < HIGH_POST_THRESHOLD) {
        const severity = posts === 0 ? 'critical' : posts < LOW_POST_HIGH ? 'high' : 'medium'
        findings.push({
          client_id: clientId,
          dimension: 'social',
          finding_type: 'low_posting_frequency',
          severity,
          title: `Low posting frequency on ${platform}`,
          description: `Only ${posts} post${posts === 1 ? '' : 's'} published in the last 30 days on ${platform}.`,
          evidence: makeEvidence({
            parsed: { platform, posts_last_30_days: posts, top_posts_30d: topPosts },
            sources: sourcesForPlatform(platform, handles),
          }),
          recommendation: 'Aim for at least 3 posts per week to maintain audience engagement.',
          fix_type: 'fde_manual',
          priority_score: posts === 0 ? 90 : posts < LOW_POST_HIGH ? 70 : 50,
        })
      }

      if (engagementRate < LOW_ENGAGE_THRESHOLD) {
        findings.push({
          client_id: clientId,
          dimension: 'social',
          finding_type: 'low_engagement_rate',
          severity: 'high',
          title: `Low engagement rate on ${platform}`,
          description: `Engagement rate is ${(engagementRate * 100).toFixed(2)}% on ${platform} — below 0.5% threshold.`,
          evidence: makeEvidence({
            parsed: { platform, engagement_rate: engagementRate, top_posts_30d: topPosts },
            sources: sourcesForPlatform(platform, handles),
          }),
          recommendation: 'Create more interactive content (polls, Q&A, calls-to-action) to boost engagement.',
          fix_type: 'fde_manual',
          priority_score: 65,
        })
      }
    }

    if (platformScores.length === 0) return { score: null, findings, post_samples }

    const avgScore = platformScores.reduce((a, b) => a + b, 0) / platformScores.length
    const diversityBonus = Math.min(20, (platformScores.length - 1) * DIVERSITY_BONUS_PER_PLATFORM)
    const score = Math.min(100, Math.round(avgScore + diversityBonus))

    return { score, findings, post_samples }
  }

  private async hasFreshCache(clientId: string): Promise<boolean> {
    const cutoff = new Date(
      Date.now() - SOCIAL_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()
    const { data } = await this.supabase
      .from('diagnostic_findings')
      .select('id')
      .eq('client_id', clientId)
      .eq('dimension', 'social')
      .gte('created_at', cutoff)
      .limit(1)
    return (data as unknown[])?.length > 0
  }

  private postFrequencyScore(posts: number): number {
    if (posts === 0) return 0
    if (posts < LOW_POST_HIGH) return 25
    if (posts < HIGH_POST_THRESHOLD) return 50
    if (posts < 24) return 75
    return 100
  }

  private engagementScore(rate: number): number {
    if (rate < LOW_ENGAGE_THRESHOLD) return 0
    if (rate < 0.01) return 25
    if (rate < 0.03) return 50
    if (rate < 0.05) return 75
    return 100
  }

  private makeMissingPresenceFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'social',
      finding_type: 'social_accounts_not_linked',
      severity: 'high',
      title: 'Social media accounts not linked',
      description:
        'No Instagram, Facebook Page, or TikTok account is linked for this client. Social performance (post frequency, engagement) cannot be measured until at least one platform is connected.',
      evidence: makeEvidence({
        parsed: { instagram_handle: null, facebook_page_url: null, tiktok_handle: null },
      }),
      recommendation:
        'Open Client Settings → Social and add the Instagram handle, Facebook Page URL, and/or TikTok handle. Prioritise Instagram + Facebook for AU/NZ markets.',
      fix_type: 'fde_manual',
      priority_score: 75,
    }
  }
}
