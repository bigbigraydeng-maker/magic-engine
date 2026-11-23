/** One client pass. Ad-platform reads go through the existing add-image inspect. */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { bindLaunchToApprovedPlan } from '@/lib/ads-launch/plan-gate'
import { nzToday } from '@/lib/ads-strategy/promo-window'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { TUNE_ACTION, adaptFinding, clipImage, pickUnusedImage, planTune, tuneSubjectKey, type TuneImage, type TuneLive } from './plan'
import { issueTune, type TuneResult } from './run'
import { readTuneSwitch } from './switch'
const SKIP = (reason: string): TuneResult => ({ kind: 'skip', issued: false, wroteMeta: false, reason, runId: null, subjectKey: null })
export async function runClientTune(
  sb: SupabaseClient,
  kernel: KernelDeps,
  clientId: string,
  findings: readonly unknown[],
  now = new Date(),
): Promise<TuneResult[]> {
  if (await readTuneSwitch(sb, clientId) !== 'on') return [SKIP('这个客户没开调方确认卡。')]
  const [images, used, accountId, plan, issued] = await Promise.all([
    loadImages(sb, clientId), usedPaths(sb, clientId), oneAccount(sb, clientId),
    bindLaunchToApprovedPlan(sb, clientId, { mode: 'ad_only' }, now), issuedKeys(sb, clientId, nzToday(now.getTime())),
  ])
  if (issued === 'unread') return [SKIP('今天的调方卡读不出来，没有出新卡。')]
  const usable = images.flatMap((row) => { const image = clipImage(row.path, row.mime, row.status, used); return image ? [image] : [] })
  const out: TuneResult[] = []
  for (const finding of findings) {
    const result = await oneFinding(sb, kernel, clientId, finding, usable, accountId, plan.ok ? plan.planId : null, issued, now)
      .catch(() => SKIP('这一组没能出卡，没有改广告。'))
    if (result.subjectKey) issued.add(result.subjectKey)
    out.push(result)
  }
  return out
}
async function oneFinding(
  sb: SupabaseClient, kernel: KernelDeps, clientId: string, finding: unknown,
  images: readonly TuneImage[], accountId: string | null, planId: string | null, issued: Set<string>, now: Date,
): Promise<TuneResult> {
  const found = adaptFinding(finding)
  const key = found ? tuneSubjectKey(found.subjectRef, nzToday(now.getTime())) : null
  const image = found?.creative ? pickUnusedImage(clientId, images) : null
  const live = image && found?.adSetId && accountId && planId ? await readLive(sb, clientId, accountId, found.adSetId, image, planId) : null
  return issueTune({ kernel, clientId, now, decision: planTune({ clientId, now, finding, images, live, already: key ? issued.has(key) : false, enabled: true }) })
}
async function readLive(sb: SupabaseClient, clientId: string, accountId: string, adSetId: string, imagePath: string, planId: string): Promise<TuneLive | null> {
  const { makeCreativeDeps } = await import('@/lib/ads-creative-card/runtime')
  const seen = await makeCreativeDeps(sb, clientId).inspect({
    adAccountId: accountId, adSetId, imagePath, primaryText: '沿用这一组正在用的句子',
    headline: '沿用现有标题', ctaType: 'LEARN_MORE', adName: '新图片', status: 'PAUSED',
  })
  const live = seen.live
  if (!seen.plan.ok || seen.plan.planId !== planId || !seen.imageUrl || !live.copy) return null
  if (live.accountKnown !== true || live.adSetStatus !== 'ACTIVE' || !live.primaryText || !live.headline) return null
  return {
    accountId, adSetId, primaryText: live.primaryText, headline: live.headline, ctaType: live.ctaType ?? 'LEARN_MORE',
    copy: live.copy, imageUrl: seen.imageUrl, planId, adSetActive: true,
  }
}
async function loadImages(sb: SupabaseClient, clientId: string): Promise<Array<{ path: string; mime: unknown; status: unknown }>> {
  const { data, error } = await sb.from('video_clips').select('storage_url, mime_type, status').eq('client_id', clientId).eq('status', 'active').limit(40)
  if (error) return []
  return ((data ?? []) as Array<{ storage_url?: unknown; mime_type?: unknown; status?: unknown }>).flatMap((row) => (
    typeof row.storage_url === 'string' ? [{ path: row.storage_url, mime: row.mime_type, status: row.status }] : []
  ))
}
async function usedPaths(sb: SupabaseClient, clientId: string): Promise<Set<string>> {
  const { data, error } = await sb.from('flywheel_actions').select('payload').eq('client_id', clientId).eq('action_type', ADS_ACTION_TYPE.ADD_AD_CREATIVE)
  const used = new Set<string>()
  if (error) return used
  for (const row of (data ?? []) as Array<{ payload?: unknown }>) {
    const path = usedPath(row.payload)
    if (path) used.add(path)
  }
  return used
}
async function oneAccount(sb: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await sb.from('client_meta_ad_accounts').select('ad_account_id').eq('client_id', clientId)
  if (error) return null
  const ids = ((data ?? []) as Array<{ ad_account_id?: unknown }>).flatMap((row) => (
    typeof row.ad_account_id === 'string' && /^act_\d{6,20}$/.test(row.ad_account_id) ? [row.ad_account_id] : []
  ))
  if (ids.length === 1) return ids[0] ?? null
  if (ids.length > 1) return null
  const fallback = await sb.from('clients').select('meta_ad_account_id').eq('id', clientId).maybeSingle()
  const id = (fallback.data as { meta_ad_account_id?: unknown } | null)?.meta_ad_account_id
  return !fallback.error && typeof id === 'string' && /^act_\d{6,20}$/.test(id) ? id : null
}
async function issuedKeys(sb: SupabaseClient, clientId: string, day: string): Promise<Set<string> | 'unread'> {
  const { data, error } = await sb.from('flywheel_actions').select('payload').eq('client_id', clientId).eq('action_type', TUNE_ACTION).eq('payload->>nzDay', day)
  if (error) return 'unread'
  const keys = new Set<string>()
  for (const row of (data ?? []) as Array<{ payload?: { subjectKey?: unknown } }>) {
    if (typeof row.payload?.subjectKey === 'string') keys.add(row.payload.subjectKey)
  }
  return keys
}
function usedPath(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as { wrote?: unknown; adId?: unknown; status?: unknown; order?: { imagePath?: unknown } }
  const path = row.order?.imagePath
  if (typeof path !== 'string') return null
  return row.wrote === true || row.status === 'executed' || typeof row.adId === 'string' ? path : null
}
