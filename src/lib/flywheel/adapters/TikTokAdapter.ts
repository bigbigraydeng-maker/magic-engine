/**
 * TikTokAdapter — Social flywheel adapter for TikTok profile metrics.
 *
 * P22.A.4:
 *   pullMetrics() — scrapes the client's TikTok profile via Apify and writes
 *                   followers / posts_last_30d / engagement_rate to flywheel_metrics.
 *
 * Data flow:
 *   Apify clockworks~tiktok-profile-scraper
 *     → TikTokAdapter.pullMetrics()
 *     → flywheel_metrics (social.tiktok.*)
 *
 * This adapter is read-only (no execute() — TikTok publishing is handled by
 * Publer via SocialContentAdapter). Only pullMetrics() is implemented.
 *
 * Auto-registers itself to the adapter registry on import.
 */

import { supabaseAdmin } from '../../supabase'
import { scrapeTiktokProfile } from '../../apify/social-scraper'
import { SOCIAL_METRIC_KEY } from '../vocabulary'
import { registerAdapter } from './registry'
import type {
  ExecuteActionInput,
  FlywheelActionRow,
  FlywheelAdapter,
  FlywheelMetricRow,
} from './types'

export class TikTokAdapter implements FlywheelAdapter {
  readonly flywheel = 'social' as const

  /**
   * TikTok is analytics-only for this adapter — publishing is handled by Publer.
   * Throws to satisfy the FlywheelAdapter interface contract.
   */
  async execute(_input: ExecuteActionInput): Promise<FlywheelActionRow> {
    throw new Error('TikTokAdapter does not support execute() — use SocialContentAdapter for social actions.')
  }

  /**
   * Scrape the client's TikTok profile via Apify and write
   * followers / posts_last_30d / engagement_rate to flywheel_metrics.
   *
   * Returns [] if:
   *   - the client has no tiktok_handle configured
   *   - APIFY_API_KEY is not set (scrape throws)
   *   - the Apify actor returns no data
   */
  async pullMetrics(clientId: string, _since?: Date): Promise<FlywheelMetricRow[]> {
    // ── 1. Look up client's TikTok handle ────────────────────────────────────
    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('tiktok_handle')
      .eq('id', clientId)
      .maybeSingle()

    if (clientErr || !client || !client.tiktok_handle) return []

    const handle = (client.tiktok_handle as string).trim()
    if (!handle) return []

    // ── 2. Scrape TikTok profile ──────────────────────────────────────────────
    let profile: Awaited<ReturnType<typeof scrapeTiktokProfile>>
    try {
      profile = await scrapeTiktokProfile(handle)
    } catch (err) {
      console.error('[TikTokAdapter] scrapeTiktokProfile error:', err instanceof Error ? err.message : String(err))
      return []
    }

    // ── 3. Build metric rows ──────────────────────────────────────────────────
    const now = new Date().toISOString()
    const sourceRef = { handle, scraped_at: now }

    type MetricEntry = { key: string; value: number | null }
    const candidates: MetricEntry[] = [
      { key: SOCIAL_METRIC_KEY.TIKTOK_FOLLOWERS,        value: profile.followersCount    },
      { key: SOCIAL_METRIC_KEY.TIKTOK_POSTS_LAST_30D,   value: profile.postsLast30Days   },
      { key: SOCIAL_METRIC_KEY.TIKTOK_ENGAGEMENT_RATE,  value: profile.engagementRate    },
    ]

    const toInsert: object[] = []
    const returned: FlywheelMetricRow[] = []

    for (const { key, value } of candidates) {
      if (value === null || value === undefined) continue
      toInsert.push({
        client_id:    clientId,
        flywheel:     'social',
        metric_key:   key,
        metric_value: value,
        source:       'tiktok_apify',
        source_ref:   sourceRef,
        measured_at:  now,
      })
      returned.push({
        id:          '',
        clientId,
        flywheel:    'social',
        metricKey:   key,
        metricValue: value,
        source:      'tiktok_apify',
        sourceRef,
        measuredAt:  now,
      })
    }

    if (toInsert.length === 0) return []

    const { error: insertErr } = await supabaseAdmin
      .from('flywheel_metrics')
      .upsert(toInsert, {
        onConflict: 'client_id,metric_key,measured_at',
        ignoreDuplicates: true,
      })

    if (insertErr) {
      console.error('[TikTokAdapter] pullMetrics upsert error:', insertErr.message)
    }

    return returned
  }
}

registerAdapter(new TikTokAdapter())
