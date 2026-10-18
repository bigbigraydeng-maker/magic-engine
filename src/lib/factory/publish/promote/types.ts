// Reel 授权后单条转公开(受控动作)— 共享类型与端口。
// 设计稿:docs/specs/2026-10-18-reel-promote-to-public-design-v0.2.md
// 平台共享:不含客户名/工单 id;所有外部依赖(库、Meta、红线闸、时钟)走端口,便于不碰真账号地完整试跑。

import type { PublishTarget, PublishedRef } from '../../types'

/** 流量记录(flywheel_actions, action_type='factory_reel_publish')。 */
export interface TrafficRow {
  id: string
  client_id: string
  payload: Record<string, unknown>
}

export interface PromoteOrder {
  id: string
  client_id: string
  status: string
  master_brief_id: string | null
  brief: Record<string, unknown>
  output: Record<string, unknown>
  review_ref: Record<string, unknown>
  published_ref: Record<string, unknown>
  updated_at: string
}

export type AuthorizationStatus = 'claimed' | 'consumed' | 'failed' | 'meta_published_db_pending'

export interface PromoteAuthorization {
  authorized_by: string
  authorized_at: string
  work_order_id: string
  video_id: string
  page_id: string
  fingerprint: string
  request_id: string
  status: AuthorizationStatus
  claimed_at: string
  promote_called_at?: string
  published_at?: string
  published_at_estimated?: boolean
  late_backfill?: boolean
  first_comment_status?: 'ok' | 'failed'
  post_publish_redline_hit?: string
  fail_reason?: string
  needs_attention?: boolean
}

export interface PreviewSlot {
  token_hash: string
  work_order_id: string
  fingerprint: string
  expires_at: string
  used: boolean
}

/** 数据端口:库的读写。casPayload 返回 true = 命中且仅命中 1 行。 */
export interface PromoteStore {
  loadOrder(id: string): Promise<PromoteOrder | null>
  /** 该工单名下全部 factory_reel_publish 流量记录(按 work_order_id + client_id + action_type)。 */
  loadTrafficRows(orderId: string, clientId: string): Promise<TrafficRow[]>
  loadTrafficRow(id: string, clientId: string): Promise<TrafficRow | null>
  /** 版本号乐观锁:expectedRev=null 表示 payload 里还没有 promote_rev。 */
  casPayload(id: string, clientId: string, expectedRev: string | null, nextPayload: Record<string, unknown>): Promise<boolean>
  /** 按 updated_at 比对写 published_ref(且 status 必须仍是 published);true = 命中 1 行。 */
  writeOrderPublishedRef(id: string, expectedUpdatedAt: string, nextRef: Record<string, unknown>): Promise<boolean>
}

export interface MetaReelView {
  published: boolean
  /** 视频所属主页 id;Meta 不返回 = null(动作会拒绝)。 */
  fromId: string | null
  description: string
  updatedTime: string | null
  permalink: string | null
}

export class PromoteMetaError extends Error {
  constructor(public readonly kind: 'video_missing' | 'other', message: string) {
    super(message)
    this.name = 'PromoteMetaError'
  }
}

/** Meta 端口。 */
export interface PromoteMeta {
  readReel(target: PublishTarget, videoId: string): Promise<MetaReelView>
  promote(target: PublishTarget, videoId: string): Promise<PublishedRef>
  ensureFirstComment(args: { target: PublishTarget; videoId: string; idempotencyTag: string; message: string }): Promise<string>
}

export interface PromoteDeps {
  store: PromoteStore
  meta: PromoteMeta
  resolveTarget(clientId: string): Promise<PublishTarget | null>
  /** 红线闸:返回 null = 放行,字符串 = 拦截原因(fail-closed)。 */
  scanRedline(clientId: string, masterBriefId: string, text: string): Promise<string | null>
  now(): Date
  uuid(): string
  /** 加密级随机令牌(明文只回给点预览的管理员)。 */
  randomToken(): string
  /** 需要人看的异常:首版写日志 + 回执 needs_attention,不接今日待办(见 PR 正文)。 */
  alert(message: string): void
}

export interface PromoteInput {
  orderId: string
  adminEmail: string
  confirm: boolean
  previewToken?: string
}

export type PromoteResult =
  | { ok: true; kind: 'preview'; data: PreviewData }
  | { ok: true; kind: 'promoted' | 'synced'; data: PromotedData }
  | { ok: false; status: number; error: string; data?: Record<string, unknown> }

export interface PreviewData {
  preview_token: string
  expires_at: string
  mode: 'promote' | 'sync_only'
  page_id: string
  video_id: string
  caption: string
  first_comment: string
  checklist_passed_at: string | null
}

export interface PromotedData {
  video_id: string
  published_at: string
  published_at_estimated: boolean
  permalink: string | null
  first_comment_status: 'ok' | 'failed'
  request_id: string
}

export const PREVIEW_TTL_MS = 5 * 60 * 1000
export const CLAIM_LEASE_MS = 5 * 60 * 1000
export const TRAFFIC_ACTION_TYPE = 'factory_reel_publish'
