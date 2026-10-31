/**
 * Winner Reel Auto-Sync engine — decides which organic Reels to promote and
 * which fatigued Ads to pause in a target Pool Builder Ad Set.
 *
 * Level-1 (pilot) design principles:
 *   - Does not write Meta. One run asks for one paused-draft confirmation card.
 *   - After a person confirms, the existing card path creates paused ads only.
 *   - Guards prevent runaway asks: max new posts per run. Fatigue is not auto-paused.
 *   - Blacklist keyword filter for content the client doesn't want promoted
 *   - Every decision is written to winner_reel_sync_log for audit + rollback
 */

import { createClient } from '@supabase/supabase-js'

import { listAdsInAdSet } from '../meta/ads-manager'
import { getAdSetStatus, type AdSetSummary } from '../meta/adsets'
import { getRegisteredAccountIds } from '../meta/campaign-ownership'
import { fetchPagePosts, getPageAccessToken, rankVideoWinners } from '../meta/page-posts'
import { getMetaTokenForClient } from '../meta/token-manager'
import { buildWinnerPausedDraft, majorBudget, requestWinnerPausedCard } from './paused-card'

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
  /** Set when this run asked for a paused-draft card. No ad exists until a person confirms. */
  cardRunId: string | null
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
): Promise<{ ok: true; adSet: AdSetSummary; adAccountId: string } | { ok: false; reason: string }> {
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
  const matched = registeredAccountIds.find((id) => normalizeAccountId(id) === configAccount)
  return { ok: true, adSet, adAccountId: matched ?? cfg.adAccountId }
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
   * The "补新素材" button must not pause other ads. The daily job also does
   * not pause: pausing is a Meta write, and this engine no longer writes Meta.
   * The flag is kept so the button's promise stays visible in the log.
   */
  skipFatiguePause?: boolean
  /**
   * Kept so callers can still say "paused only". Ignored as a Meta status:
   * this engine never creates an ad, and the card's publisher always uses PAUSED.
   * A config value of ACTIVE cannot turn that into a live ad.
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
    cardRunId: null,
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

    // ── Step 3 · One paused-draft card. No Meta write, whatever the config says.
    const toAdd = missingWinners.slice(0, cfg.maxNewAdsPerRun)
    if (missingWinners.length > cfg.maxNewAdsPerRun) result.guardsHit.push('max_new_ads_per_run')
    const configuredStatus = opts.newAdStatusOverride ?? cfg.newAdDefaultStatus
    result.guardsHit.push(`new_ad_status_ignored:${configuredStatus}`)
    if (toAdd.length > 0) {
      const built = buildWinnerPausedDraft({
        clientId: cfg.clientId,
        pageId: cfg.fbPageId,
        adSetId: cfg.targetAdsetId,
        adSetName: ownership.adSet.name,
        dailyBudgetMajor: majorBudget(ownership.adSet.daily_budget),
        winners: toAdd,
      })
      if (!built.draft) {
        result.guardsHit.push(built.blocked ?? 'winner_skipped_no_caption')
      } else {
        if (built.skipped > 0) result.guardsHit.push('winner_skipped_no_caption')
        try {
          const card = await requestWinnerPausedCard({
            supabase: supabaseAdmin,
            clientId: cfg.clientId,
            adAccountId: ownership.adAccountId,
            draft: built.draft,
          })
          result.cardRunId = card.runId
          result.guardsHit.push('paused_draft_card')
        } catch {
          console.error('[winner-reel-sync] paused draft card was not issued')
          result.status = 'error'
          result.errorMessage = '确认卡没有出成，没有去建广告'
          result.guardsHit.push('card_failed')
          await writeLog(result)
          return result
        }
      }
    }

    // Fatigue pause is a Meta write. It stays off until it has its own card.
    result.guardsHit.push(opts.skipFatiguePause ? 'fatigue_pause_skipped' : 'fatigue_pause_not_written')

    await writeLog(result)

    if (result.cardRunId) {
      await notifySlack(
        cfg.slackWebhookUrl,
        '赢家素材同步出了一张暂停草稿确认卡。还没有建广告，也没有改预算。',
      )
    }

    return result
  } catch (e) {
    result.status = 'error'
    result.errorMessage = e instanceof Error ? e.message : String(e)
    await writeLog(result)
    return result
  }
}
