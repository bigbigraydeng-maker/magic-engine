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
import { getAdSetStatus } from '../meta/adsets'
import { getRegisteredAccountIds } from '../meta/campaign-ownership'
import { fetchPagePosts, getPageAccessToken, rankVideoWinners } from '../meta/page-posts'
import { getMetaTokenForClient } from '../meta/token-manager'
import { linkAdToCreative } from '../ads/creative-link'

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
  adsAdded:  Array<{
    adId: string
    name: string
    postId: string
    score: number
    /** 这条广告投的是 ME 的哪条片子;null = 认不出来(如实留白,绝不猜)。 */
    creativeRef: string | null
  }>
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

function normalizeAccountId(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}

/**
 * AD-SEC-1：`winner_reel_sync_config` 这张表自己没有归属校验——如果某一行
 * 配错/串成了别的客户的 ad_account_id / fb_page_id / target_adset_id，这个
 * engine 会往错的客户账户里建广告、暂停错客户的广告。触发它的两处（每日
 * cron + 看板「补新素材」按钮）都不收实体 id，没法在入口拦，守卫只能放在
 * 这里、读配置之后、碰 Meta 之前。
 *
 * 🔴 局限：账户按 `client_meta_ad_accounts` 登记集合核对、主页按 `clients.facebook_page_id`
 * 核对（2026-09-14 起主页绑定只许内部员工改），挡的是「配置行串到了别的客户」这一类。
 * 共用同一个 Meta 广告账户的客户（2026-09-14 生产实查：Roman HU 与 30 Kiteroa 同登记
 * act_1260456876069575）`ad_account_id` 天然相同——这条守卫对「同账户内配错到另一个
 * 共享该账户的客户」挡不住，跟 `campaign-ownership.ts` 是同一个已知局限，根治需要
 * 广告系列级归属表（ads IMPACT 设计 §4.1④，阶段 2）。`target_adset_id` 这条（Codex 复审 P1 指出的缺口）
 * 改成真拉 Meta 核实 ad set 实际挂在哪个账户下——能挡住「账户/主页碰巧都对，
 * 但 ad set id 打错/串到别的账户」这一类，仍挡不住"同一个共享账户内，ad set
 * 也刚好属于共用该账户的另一个客户"这种更深的情况（同一条已知局限）。
 */
async function assertConfigOwnedByClient(
  cfg: SyncConfig,
  clientId: string,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // 账户按多账户登记表核对（2026-09-14 ADS-IMPACT-P0-1）：CTS 有个人号 + 官方账户两个，
  // 只认 clients.meta_ad_account_id 会把官方账户上的配置误拦。查询出错 fail closed。
  const { ids: registeredAccountIds, error: registryError } = await getRegisteredAccountIds(clientId)
  if (registryError) return { ok: false, reason: registryError }

  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()

  if (error) return { ok: false, reason: `查不到客户的主页登记：${error.message}` }
  const registeredPageId = (client as { facebook_page_id?: string | null } | null)
    ?.facebook_page_id

  const configAccount = normalizeAccountId(cfg.adAccountId)
  if (!registeredAccountIds.some(id => normalizeAccountId(id) === configAccount)) {
    return { ok: false, reason: 'winner_reel_sync_config 里的广告账户不在这个客户登记的任何广告账户里，已拒绝执行（防止配错到别家客户账户）' }
  }
  if (!registeredPageId || cfg.fbPageId !== registeredPageId) {
    return { ok: false, reason: 'winner_reel_sync_config 里的 Facebook 主页跟这个客户在 clients 表登记的对不上，已拒绝执行' }
  }

  const adSet = await getAdSetStatus(cfg.targetAdsetId, accessToken)
  if (!adSet) {
    return { ok: false, reason: `读不到 winner_reel_sync_config 里配置的广告组（${cfg.targetAdsetId}），无法核对归属，已拒绝执行` }
  }
  // 广告组必须就在配置的那个账户里，不能只是「属于该客户的某个账户」——否则配置写官方账户、
  // 广告组却在个人号，后续按配置账户建广告会建错地方。
  if (!adSet.account_id || normalizeAccountId(adSet.account_id) !== configAccount) {
    return { ok: false, reason: 'winner_reel_sync_config 里的 target_adset_id 不在配置的广告账户里，已拒绝执行（防止配错/串到别家客户的广告组）' }
  }
  return { ok: true }
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

export interface SyncOptions {
  /**
   * Skip Step 4 (fatigue-pause pass). Used by the ads-health "补新素材" button
   * (P21.K.6): a button labelled "add creatives" must never also pause ads —
   * that would be an action beyond what the user consented to. The daily cron
   * omits this and keeps the full pipeline.
   */
  skipFatiguePause?: boolean
  /**
   * Force the status new ads are created with, overriding the client config.
   * The prescription button PROMISES "暂停、不花钱" in its confirm dialog, so it
   * must hold even after a client's config flips new_ad_default_status to
   * ACTIVE (Level-2 rollout) — a button may never spend money it said it
   * wouldn't (魏征 P1-2). The cron keeps following config.
   */
  newAdStatusOverride?: 'PAUSED'
}

export async function syncWinnerReels(clientId: string, opts: SyncOptions = {}): Promise<SyncResult> {
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

    // AD-SEC-1：读到配置之后、碰 Meta 之前，先核对这行配置真的是这个客户的
    // （包括 target_adset_id 本身是不是挂在已核对过的账户下——Codex 复审 P1
    // 指出账户/主页对得上不代表 ad set 也对得上，需要拿 token 去 Meta 实查）。
    const ownership = await assertConfigOwnedByClient(cfg, clientId, userToken)
    if (!ownership.ok) {
      result.status = 'error'
      result.errorMessage = ownership.reason
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
          status: opts.newAdStatusOverride ?? cfg.newAdDefaultStatus,
          accessToken: userToken,
        })
        // 记「这条广告投的是哪条片」。必须紧跟建广告 —— 这是唯一知道对应关系的时刻。
        // 永不抛异常,所以放在同一个 try 里也不会把已建出的广告算成失败。
        const link = await linkAdToCreative({
          clientId: cfg.clientId,
          adId,
          postId: w.postId,
          pageId: cfg.fbPageId,
          createdBy: 'winner_reel_sync',
        })
        result.adsAdded.push({ adId, name, postId: w.postId, score: w.score, creativeRef: link.creativeRef })
      } catch (e) {
        // one failure should not block the rest
        result.guardsHit.push(`create_failed:${w.postId}`)
      }
    }

    // ── Step 4 · Fatigue pause pass (with guards)
    const active = currentAds.filter((a) => a.status === 'ACTIVE')
    if (opts.skipFatiguePause) {
      result.guardsHit.push('fatigue_pause_skipped')
    } else if (active.length < cfg.minActiveAds) {
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
