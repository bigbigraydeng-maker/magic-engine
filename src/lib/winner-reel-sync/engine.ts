/**
 * Winner Reel Auto-Sync engine — decides which organic Reels to promote and
 * which fatigued Ads to pause in a target Pool Builder Ad Set.
 *
 * The daily job and the replenish button only propose confirmation cards.
 * They do not create ads and they do not pause ads.
 * A person confirms in ME. Creation stays paused. Opening is a second card.
 * A pause suggestion is handed to the existing pause card.
 *
 * Level-1 guards still apply: min active Ads, min Ad age, max new per run,
 * blacklist, and an audit row in winner_reel_sync_log.
 */

import { createClient } from '@supabase/supabase-js'

import { fetchCTRForAds, listAdsInAdSet } from '../meta/ads-manager'
import { getAdSetStatus } from '../meta/adsets'
import { getRegisteredAccountIds } from '../meta/campaign-ownership'
import { fetchPagePosts, getPageAccessToken, rankVideoWinners } from '../meta/page-posts'
import { getMetaTokenForClient } from '../meta/token-manager'
import type { CardClicker } from '@/lib/confirmation-card'
import type { AddIntent, PauseIntent } from './intents'
import { proposeWinnerBatch } from './propose'

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
    /** 出卡时还没有广告，片子对应关系要等确认后才记。 */
    creativeRef: string | null
    proposalRunId?: string
  }>
  adsPaused: Array<{ adId: string; name: string; reason: string; ctr: number | null; proposalRunId?: string }>
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
   * Kept so the replenish button can still say "暂停". It no longer changes
   * a write. A config that asked for ACTIVE is recorded and still only proposes.
   */
  newAdStatusOverride?: 'PAUSED'
  /** Who asked for the cards. The daily job has no person, so it uses an agent. */
  clicker?: CardClicker
}

export interface WinnerSuggestions {
  status: SyncResult['status']
  errorMessage?: string
  postsScanned: number
  winnersFound: number
  guardsHit: string[]
  adds: AddIntent[]
  pauses: PauseIntent[]
  configAskedActive: boolean
  slackWebhookUrl: string | null
}

export async function syncWinnerReels(clientId: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const plan = await collectWinnerSuggestions(clientId, opts)
  const result = emptyResult(clientId, plan)
  if (plan.status !== 'ok') {
    await writeLog(result)
    return result
  }
  const proposed = await proposeWinnerBatch({
    supabase: supabaseAdmin,
    clientId,
    clicker: opts.clicker ?? { kind: 'agent', email: null },
    adds: plan.adds,
    pauses: plan.pauses,
    configAskedActive: plan.configAskedActive,
  })
  result.adsAdded = proposed.added
  result.adsPaused = proposed.paused
  result.guardsHit.push(...proposed.guards)
  await writeLog(result)
  await notifyIfNeeded(plan.slackWebhookUrl, clientId, result)
  return result
}

/** Read-only scan. Confirm calls this again so a stale card cannot write. */
export async function collectWinnerSuggestions(clientId: string, opts: SyncOptions = {}): Promise<WinnerSuggestions> {
  const blank = emptySuggestions()
  try {
    return await scan(clientId, opts, blank)
  } catch (error) {
    return { ...blank, status: 'error', errorMessage: error instanceof Error ? error.message : String(error) }
  }
}

async function scan(clientId: string, opts: SyncOptions, blank: WinnerSuggestions): Promise<WinnerSuggestions> {
  const cfg = await loadConfig(clientId)
  if (!cfg) return { ...blank, status: 'skipped', errorMessage: 'sync disabled or config missing' }
  const userToken = await getMetaTokenForClient(clientId)
  if (!userToken) return { ...blank, status: 'error', errorMessage: 'Meta token not configured' }
  const ownership = await assertConfigOwnedByClient(cfg, clientId, userToken)
  if (!ownership.ok) return { ...blank, status: 'error', errorMessage: ownership.reason }
  const pageToken = await getPageAccessToken(userToken, cfg.fbPageId)
  if (!pageToken) {
    return { ...blank, status: 'error', errorMessage: 'Page access token unavailable (check pages_show_list scope)' }
  }
  const posts = await fetchPagePosts(cfg.fbPageId, pageToken, 30)
  const winners = rankVideoWinners(posts, cfg.blacklistKeywords, cfg.winnerMinScore)
  const currentAds = await listAdsInAdSet(cfg.targetAdsetId, userToken)
  const currentPostIds = new Set(currentAds.map((ad) => ad.effectiveObjectStoryId?.split('_')[1]).filter((id): id is string => Boolean(id)))
  const result = emptyResult(clientId, blank)
  const adds = addIntents(winners.filter((winner) => !currentPostIds.has(winner.postId)), cfg, result)
  const pauses = await pauseIntents(currentAds, cfg, userToken, opts, result)
  if (cfg.newAdDefaultStatus === 'ACTIVE') result.guardsHit.push('active_default_propose_only')
  if (opts.newAdStatusOverride === 'PAUSED') result.guardsHit.push('status_override_ignored')
  return {
    status: 'ok',
    postsScanned: posts.length,
    winnersFound: winners.length,
    guardsHit: result.guardsHit,
    adds,
    pauses,
    configAskedActive: cfg.newAdDefaultStatus === 'ACTIVE',
    slackWebhookUrl: cfg.slackWebhookUrl,
  }
}

function emptySuggestions(): WinnerSuggestions {
  return {
    status: 'ok', postsScanned: 0, winnersFound: 0, guardsHit: [],
    adds: [], pauses: [], configAskedActive: false, slackWebhookUrl: null,
  }
}

function emptyResult(clientId: string, plan: WinnerSuggestions): SyncResult {
  return {
    clientId,
    postsScanned: plan.postsScanned,
    winnersFound: plan.winnersFound,
    adsAdded: [],
    adsPaused: [],
    guardsHit: [...plan.guardsHit],
    status: plan.status,
    errorMessage: plan.errorMessage,
  }
}

async function notifyIfNeeded(webhook: string | null, clientId: string, result: SyncResult): Promise<void> {
  if (result.adsAdded.length === 0 && result.adsPaused.length === 0) return
  const summary = [
    `🎯 Winner Reel Sync · client ${clientId}`,
    result.adsAdded.length > 0 ? `  ✅ 建议加 ${result.adsAdded.length} 条（确认后才建成暂停）` : null,
    result.adsPaused.length > 0 ? `  ⏸️ 建议停 ${result.adsPaused.length} 条（确认后才走暂停卡）` : null,
    result.guardsHit.length > 0 ? `  🛡️ Guards hit: ${result.guardsHit.join(', ')}` : null,
  ].filter(Boolean).join('\n')
  await notifySlack(webhook, summary)
}

function addIntents(
  missing: Array<{ postId: string; message: string; score: number }>,
  cfg: SyncConfig,
  result: SyncResult,
): AddIntent[] {
  const capped = missing.slice(0, cfg.maxNewAdsPerRun)
  if (missing.length > cfg.maxNewAdsPerRun) result.guardsHit.push('max_new_ads_per_run')
  return capped.map((winner) => ({
    postId: winner.postId,
    name: adName(winner.message),
    score: winner.score,
    pageId: cfg.fbPageId,
    adAccountId: cfg.adAccountId,
    adsetId: cfg.targetAdsetId,
  }))
}

async function pauseIntents(
  currentAds: Awaited<ReturnType<typeof listAdsInAdSet>>,
  cfg: SyncConfig,
  userToken: string,
  opts: SyncOptions,
  result: SyncResult,
): Promise<PauseIntent[]> {
  const active = currentAds.filter((ad) => ad.status === 'ACTIVE')
  if (opts.skipFatiguePause) {
    result.guardsHit.push('fatigue_pause_skipped')
    return []
  }
  if (active.length < cfg.minActiveAds) {
    result.guardsHit.push('min_active_ads')
    return []
  }
  const cutoff = Date.now() - cfg.adMinAgeDays * 86_400_000
  const eligible = active.filter((ad) => new Date(ad.createdTime).getTime() < cutoff)
  if (eligible.length === 0) {
    result.guardsHit.push('ad_min_age_days')
    return []
  }
  return fatigued(eligible, active.length, cfg, userToken, result)
}

async function fatigued(
  eligible: Awaited<ReturnType<typeof listAdsInAdSet>>,
  activeCount: number,
  cfg: SyncConfig,
  userToken: string,
  result: SyncResult,
): Promise<PauseIntent[]> {
  const ctrMap = await fetchCTRForAds(eligible.map((ad) => ad.adId), userToken, 7)
  const valid = Object.values(ctrMap).filter((value): value is number => value !== null)
  if (valid.length < 3) {
    result.guardsHit.push('insufficient_ctr_signal')
    return []
  }
  const threshold = medianOf(valid) * 0.5
  const pauses: PauseIntent[] = []
  for (const ad of eligible) {
    const ctr = ctrMap[ad.adId]
    if (activeCount - pauses.length - 1 < cfg.minActiveAds) {
      result.guardsHit.push('min_active_ads_pause_stop')
      break
    }
    if (ctr !== null && ctr < threshold) {
      pauses.push(pauseIntent(ad, ctr, threshold, cfg))
    }
  }
  return pauses
}

function pauseIntent(
  ad: { adId: string; name: string },
  ctr: number,
  threshold: number,
  cfg: SyncConfig,
): PauseIntent {
  return {
    adId: ad.adId,
    name: ad.name,
    reason: `点击率低于同组中位数的一半（线 ${threshold.toFixed(2)}）`,
    ctr,
    pageId: cfg.fbPageId,
    adAccountId: cfg.adAccountId,
    adsetId: cfg.targetAdsetId,
  }
}

function adName(message: string): string {
  const preview = message.replace(/[{}[\]`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return `爆款暂停稿 ${preview || '跑赢的帖子'}`.slice(0, 90)
}

function medianOf(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}
