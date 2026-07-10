/**
 * Winner Reel Auto-Sync engine — decides which organic Reels to promote and
 * which fatigued Ads to pause in a target Pool Builder Ad Set.
 *
 * Level-1 (pilot) design principles:
 *   - New Ads default to PAUSED (Slack notifies FDE for approval)
 *   - Guards prevent runaway auto-changes: min active Ads, min Ad age, max new per run
 *   - Blacklist keyword filter for content the client doesn't want promoted
 *   - Every decision is written to winner_reel_sync_log for audit + rollback
 */

import { createClient } from '@supabase/supabase-js'

import {
  createAdFromPost,
  fetchCTRForAds,
  listAdsInAdSet,
  pauseAd,
} from '../meta/ads-manager'
import { fetchPagePosts, getPageAccessToken, rankVideoWinners } from '../meta/page-posts'
import { getMetaTokenForClient } from '../meta/token-manager'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface SyncConfig {
  clientId: string
  fbPageId: string
  adAccountId: string       // "act_..." format
  targetAdsetId: string
  minActiveAds: number
  adMinAgeDays: number
  maxNewAdsPerRun: number
  winnerMinScore: number
  newAdDefaultStatus: 'PAUSED' | 'ACTIVE'
  blacklistKeywords: string[]
  slackWebhookUrl: string | null
}

export interface SyncResult {
  clientId: string
  postsScanned: number
  winnersFound: number
  adsAdded:  Array<{ adId: string; name: string; postId: string; score: number }>
  adsPaused: Array<{ adId: string; name: string; reason: string; ctr: number | null }>
  guardsHit: string[]
  status: 'ok' | 'skipped' | 'error'
  errorMessage?: string
}

// ────────────────────────────────────────────────────────────────────────────
// Config loader
// ────────────────────────────────────────────────────────────────────────────

async function loadConfig(clientId: string): Promise<SyncConfig | null> {
  const { data, error } = await supabaseAdmin
    .from('winner_reel_sync_config')
    .select('*')
    .eq('client_id', clientId)
    .eq('enabled', true)
    .maybeSingle()

  if (error || !data) return null
  return {
    clientId: data.client_id,
    fbPageId: data.fb_page_id,
    adAccountId: data.ad_account_id.startsWith('act_')
      ? data.ad_account_id
      : `act_${data.ad_account_id}`,
    targetAdsetId: data.target_adset_id,
    minActiveAds: data.min_active_ads,
    adMinAgeDays: data.ad_min_age_days,
    maxNewAdsPerRun: data.max_new_ads_per_run,
    winnerMinScore: data.winner_min_score,
    newAdDefaultStatus: data.new_ad_default_status,
    blacklistKeywords: data.blacklist_keywords ?? [],
    slackWebhookUrl: data.slack_webhook_url ?? null,
  }
}

async function writeLog(result: SyncResult): Promise<void> {
  await supabaseAdmin.from('winner_reel_sync_log').insert({
    client_id: result.clientId,
    posts_scanned: result.postsScanned,
    winners_found: result.winnersFound,
    ads_added:  result.adsAdded,
    ads_paused: result.adsPaused,
    guards_hit: result.guardsHit,
    status: result.status,
    error_message: result.errorMessage ?? null,
  })
}

async function notifySlack(webhook: string | null, text: string): Promise<void> {
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch {
    // slack failure must not block the run
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry — syncWinnerReels(clientId)
// ────────────────────────────────────────────────────────────────────────────

export async function syncWinnerReels(clientId: string): Promise<SyncResult> {
  const result: SyncResult = {
    clientId,
    postsScanned: 0,
    winnersFound: 0,
    adsAdded: [],
    adsPaused: [],
    guardsHit: [],
    status: 'ok',
  }

  try {
    const cfg = await loadConfig(clientId)
    if (!cfg) {
      result.status = 'skipped'
      result.errorMessage = 'sync disabled or config missing'
      await writeLog(result)
      return result
    }

    const userToken = await getMetaTokenForClient(clientId)
    if (!userToken) {
      result.status = 'error'
      result.errorMessage = 'Meta token not configured'
      await writeLog(result)
      return result
    }

    const pageToken = await getPageAccessToken(userToken, cfg.fbPageId)
    if (!pageToken) {
      result.status = 'error'
      result.errorMessage = 'Page access token unavailable (check pages_show_list scope)'
      await writeLog(result)
      return result
    }

    // ── Step 1 · Pull organic posts + rank video winners
    const posts = await fetchPagePosts(cfg.fbPageId, pageToken, 30)
    result.postsScanned = posts.length

    const winners = rankVideoWinners(posts, cfg.blacklistKeywords, cfg.winnerMinScore)
    result.winnersFound = winners.length

    // ── Step 2 · Diff against current Ad Set
    const currentAds = await listAdsInAdSet(cfg.targetAdsetId, userToken)
    const currentPostIds = new Set(
      currentAds
        .map((a) => a.effectiveObjectStoryId?.split('_')[1])
        .filter((v): v is string => Boolean(v)),
    )
    const missingWinners = winners.filter((w) => !currentPostIds.has(w.postId))

    // ── Step 3 · Add missing winners (capped)
    const toAdd = missingWinners.slice(0, cfg.maxNewAdsPerRun)
    if (missingWinners.length > cfg.maxNewAdsPerRun) result.guardsHit.push('max_new_ads_per_run')

    for (const w of toAdd) {
      try {
        const preview = w.message.slice(0, 30).replace(/\s+/g, ' ')
        const name = `Auto: ${preview} [${w.postId.slice(-6)}]`.slice(0, 90)
        const { adId } = await createAdFromPost({
          adAccountId: cfg.adAccountId,
          adsetId: cfg.targetAdsetId,
          pageId: cfg.fbPageId,
          postId: w.postId,
          name,
          status: cfg.newAdDefaultStatus,
          accessToken: userToken,
        })
        result.adsAdded.push({ adId, name, postId: w.postId, score: w.score })
      } catch (e) {
        // one failure should not block the rest
        result.guardsHit.push(`create_failed:${w.postId}`)
      }
    }

    // ── Step 4 · Fatigue pause pass (with guards)
    const active = currentAds.filter((a) => a.status === 'ACTIVE')
    if (active.length < cfg.minActiveAds) {
      result.guardsHit.push('min_active_ads')
    } else {
      const cutoff = Date.now() - cfg.adMinAgeDays * 86_400_000
      const eligibleForPause = active.filter(
        (a) => new Date(a.createdTime).getTime() < cutoff,
      )

      if (eligibleForPause.length === 0) {
        result.guardsHit.push('ad_min_age_days')
      } else {
        // Pull recent CTR to spot fatigue; median-based comparison
        const ctrMap = await fetchCTRForAds(eligibleForPause.map((a) => a.adId), userToken, 7)
        const validCTRs = Object.values(ctrMap).filter((v): v is number => v !== null)

        if (validCTRs.length >= 3) {
          const median = medianOf(validCTRs)
          const threshold = median * 0.5

          for (const ad of eligibleForPause) {
            const ctr = ctrMap[ad.adId]
            // Guard: never pause below min_active_ads
            const wouldRemain = active.length - result.adsPaused.length - 1
            if (wouldRemain < cfg.minActiveAds) {
              result.guardsHit.push('min_active_ads_pause_stop')
              break
            }
            if (ctr !== null && ctr < threshold) {
              try {
                await pauseAd(ad.adId, userToken)
                result.adsPaused.push({
                  adId: ad.adId,
                  name: ad.name,
                  reason: `CTR ${ctr.toFixed(2)} < median ${median.toFixed(2)} × 0.5`,
                  ctr,
                })
              } catch {
                result.guardsHit.push(`pause_failed:${ad.adId}`)
              }
            }
          }
        } else {
          result.guardsHit.push('insufficient_ctr_signal')
        }
      }
    }

    await writeLog(result)

    if (result.adsAdded.length > 0 || result.adsPaused.length > 0) {
      const summary = [
        `🎯 Winner Reel Sync · client ${clientId}`,
        result.adsAdded.length  > 0 ? `  ✅ Added ${result.adsAdded.length} Ad(s)`  : null,
        result.adsPaused.length > 0 ? `  ⏸️ Paused ${result.adsPaused.length} Ad(s)` : null,
        result.guardsHit.length > 0 ? `  🛡️ Guards hit: ${result.guardsHit.join(', ')}` : null,
      ].filter(Boolean).join('\n')
      await notifySlack(cfg.slackWebhookUrl, summary)
    }

    return result
  } catch (e) {
    result.status = 'error'
    result.errorMessage = e instanceof Error ? e.message : String(e)
    await writeLog(result)
    return result
  }
}

function medianOf(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}
