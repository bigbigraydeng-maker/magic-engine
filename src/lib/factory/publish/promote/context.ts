// 转公开动作:每次请求先装配「事实上下文」(库 + Meta 回读 + 红线 + 指纹),任何一项拿不准就拒绝。

import { buildReelFirstComment, buildReelPostCaption } from '@/lib/social/reel-publishing'
import type { PublishTarget } from '../../types'
import {
  asRecord, checkOrderPrechecks, computeFingerprint, normalizeForCompare, redlineSurface,
} from './guards'
import {
  PromoteMetaError,
  type MetaReelView, type PromoteDeps, type PromoteOrder, type PromoteResult, type TrafficRow,
} from './types'

export interface PromoteContext {
  order: PromoteOrder
  target: PublishTarget
  row: TrafficRow
  videoId: string
  pageId: string
  approvedAt: string
  view: MetaReelView
  caption: string
  firstComment: string
  fingerprint: string
}

type Fail = Extract<PromoteResult, { ok: false }>
const fail = (status: number, error: string): Fail => ({ ok: false, status, error })

/** 读回 Meta;区分「视频已不存在」与「不属本页」(设计稿第 4 节)。 */
async function readView(deps: PromoteDeps, target: PublishTarget, videoId: string, pageId: string): Promise<MetaReelView | Fail> {
  try {
    const view = await deps.meta.readReel(target, videoId)
    if (!view.fromId) return fail(422, 'Meta 没有返回视频所属主页,保守拒绝')
    if (view.fromId !== pageId) return fail(409, '这条视频不属于本客户的主页,已拦截')
    return view
  } catch (e) {
    if (e instanceof PromoteMetaError && e.kind === 'video_missing') return fail(404, '这条视频在 Facebook 上已经不存在(可能被删了)')
    return fail(502, `读取 Facebook 视频失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 草稿文案必须与库里一致,且不含红线;已被人手公开的帖子不做这一步(无法再拦,转为事后告警)。 */
async function checkDraftContent(deps: PromoteDeps, order: PromoteOrder, view: MetaReelView, caption: string, firstComment: string): Promise<Fail | null> {
  if (view.published) return null
  if (normalizeForCompare(view.description) !== normalizeForCompare(caption)) {
    return fail(409, '草稿文案与库里的不一致,请先核对 Facebook 上的草稿')
  }
  const text = `${redlineSurface(view.description)}\n${redlineSurface(firstComment)}`
  const hit = await deps.scanRedline(order.client_id, order.master_brief_id ?? '', text)
  return hit ? fail(422, hit) : null
}

export async function buildContext(deps: PromoteDeps, order: PromoteOrder): Promise<PromoteContext | Fail> {
  const target = await deps.resolveTarget(order.client_id)
  const rows = await deps.store.loadTrafficRows(order.id, order.client_id)
  const pre = checkOrderPrechecks({ order, rows, target })
  if (!pre.ok) return fail(pre.status, pre.error)
  if (!target) return fail(422, '发布目标未配置')

  const copy = asRecord(asRecord(order.brief)['copy'])
  const caption = buildReelPostCaption(copy)
  const first = buildReelFirstComment(asRecord(copy['endcard']), order.id)
  if (!caption || !first) return fail(422, '工单的正文或首评链接无效,不能转公开')

  const view = await readView(deps, target, pre.videoId, pre.pageId)
  if ('ok' in view) return view
  const blocked = await checkDraftContent(deps, order, view, caption, first.text)
  if (blocked) return blocked

  const fingerprint = computeFingerprint({
    videoId: pre.videoId, description: view.description, firstComment: first.text, approvedAt: pre.approvedAt,
  })
  return { order, target, row: pre.row, videoId: pre.videoId, pageId: pre.pageId, approvedAt: pre.approvedAt, view, caption, firstComment: first.text, fingerprint }
}
