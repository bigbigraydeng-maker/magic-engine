// Reel 授权后单条转公开(受控动作)— 纯函数护栏。
// 设计稿:docs/specs/2026-10-18-reel-promote-to-public-design-v0.2.md
// 本文件只放纯函数:无网络、无数据库、无时钟、无随机。所有外部依赖由调用方注入。
// 目的:把「能不能转公开」的判断集中到一处,便于单测穷举,也便于 fail-closed 审计。

import { createHash, timingSafeEqual } from 'node:crypto'
import {
  REEL_AUTO_CHECK_KEYS,
  checklistPasses,
  humanKeysForStored,
  validateContentChecklist,
} from '@/lib/social/content-review'
import type { PublishTarget } from '../../types'
import type { PromoteOrder, TrafficRow } from './types'

// ── 文本归一化 ────────────────────────────────────────────────────────────────

/**
 * 去掉零宽/不可见字符。红线绕过最常见的手法就是往词里塞零宽字符,
 * 让「品牌名」在肉眼看来一模一样、在字符串比较里却不同。
 * 覆盖:U+200B-U+200F、U+2060-U+2064、U+FEFF、U+00AD、U+2066-U+2069。
 */
export function stripInvisible(s: string): string {
  return s.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u2066-\u2069]/g, '')
}

/**
 * 比较用的归一化:去不可见字符 → NFKC(全角/兼容字符折叠)→ 空白折叠 → trim。
 * 只用于「比较」,绝不用于「发布」——发出去的正文必须保持原样。
 */
export function normalizeForCompare(s: string): string {
  return stripInvisible(s).normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/**
 * 红线扫描用的「双面」文本:第一面是归一化后的原文,第二面是去掉所有
 * 空白/标点/符号后的「骨架」。两串一起交给红线扫描器,任何一面命中都算命中。
 * 这样「品·牌」「品 牌」「品-牌」这类插标点绕过也会被第二面抓住。
 */
export function redlineSurface(s: string): string {
  const a = normalizeForCompare(s)
  const b = a.replace(/[\p{P}\p{S}\s]+/gu, '')
  return `${a}\n${b}`
}

// ── 指纹与令牌 ────────────────────────────────────────────────────────────────

/**
 * 授权指纹:把「这次授权到底授权了什么」压成一个 sha256。
 * 预览时算一次、执行时再算一次,不一致 = 内容在预览后被改过 → 拒绝执行。
 * 参与指纹的字段刻意只取「会改变发布结果」的四项。
 */
export function computeFingerprint(input: {
  videoId: string
  description: string
  firstComment: string
  approvedAt: string
}): string {
  const payload = [
    input.videoId,
    normalizeForCompare(input.description),
    normalizeForCompare(input.firstComment),
    input.approvedAt,
  ]
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/** 预览令牌的哈希:库里只存哈希,明文只回给点预览的管理员一次。 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 常量时间比较两个十六进制哈希;长度不同直接 false(不泄露长度信息之外的东西)。 */
export function hashesEqual(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length) return false
  const a = Buffer.from(aHex, 'utf8')
  const b = Buffer.from(bHex, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** 邮箱 → 槽位键:同一邮箱(大小写/首尾空白不同)落到同一槽,防并发双开预览。 */
export function emailSlot(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 16)
}

// ── 结构收窄 ──────────────────────────────────────────────────────────────────

/** 把 unknown 收窄成「普通对象」;数组、null、原始值一律返回 {}。 */
export function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  return v as Record<string, unknown>
}

// ── 前置检查 ──────────────────────────────────────────────────────────────────

export type PrecheckResult =
  | { ok: true; row: TrafficRow; videoId: string; pageId: string; approvedAt: string }
  | { ok: false; status: number; error: string }

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/**
 * 转公开前的全部前置检查。fail-closed:任何一项拿不准都拒绝。
 * 顺序刻意从「配置」到「状态」到「内容」到「数据一致性」,让报错尽量指向根因。
 */
export function checkOrderPrechecks(input: {
  order: PromoteOrder
  rows: TrafficRow[]
  target: PublishTarget | null
}): PrecheckResult {
  const { order, rows, target } = input

  if (!target || target.platform !== 'facebook' || !nonEmptyString(target.page_id)) {
    return { ok: false, status: 422, error: '发布目标未配置或不是 Facebook 主页,不能转公开' }
  }
  if (!nonEmptyString(target.expect_brand)) {
    return { ok: false, status: 422, error: '防误发品牌名缺失,不能转公开' }
  }
  if (order.status !== 'published') {
    return { ok: false, status: 409, error: '工单状态不是已发布,不能转公开' }
  }

  const publishedRef = asRecord(order.published_ref)
  if (publishedRef['video_state'] !== 'DRAFT') {
    return { ok: false, status: 409, error: '只有草稿(DRAFT)状态的 Reel 才能转公开' }
  }
  if (!nonEmptyString(order.master_brief_id)) {
    return { ok: false, status: 422, error: '工单缺少 master_brief_id,不能转公开' }
  }

  const reviewRef = asRecord(order.review_ref)
  const output = asRecord(order.output)
  const humanChecklist = validateContentChecklist(
    reviewRef['checklist_human'],
    humanKeysForStored(reviewRef['checklist_human']),
    'HUMAN',
  )
  const autoChecklist = validateContentChecklist(
    output['quality_checklist_auto'],
    REEL_AUTO_CHECK_KEYS,
    'AUTO',
  )
  if (
    !humanChecklist.ok ||
    !autoChecklist.ok ||
    !checklistPasses(humanChecklist.items) ||
    !checklistPasses(autoChecklist.items)
  ) {
    return { ok: false, status: 409, error: '审片清单缺失、未完成或未通过,不能转公开' }
  }

  if (rows.length === 0) {
    return { ok: false, status: 409, error: '找不到该工单的发布流量记录,不能转公开' }
  }
  if (rows.length > 1) {
    return { ok: false, status: 409, error: '该工单有多条发布流量记录,无法确定转哪一条,不能转公开' }
  }

  const row = rows[0]
  const payload = asRecord(row.payload)
  const orderVideoId = nonEmptyString(publishedRef['video_id'])
  const rowVideoId = nonEmptyString(payload['video_id'])
  if (!orderVideoId || !rowVideoId || orderVideoId !== rowVideoId) {
    return { ok: false, status: 409, error: '工单与流量记录的视频 id 不一致,不能转公开' }
  }

  const orderPageId = nonEmptyString(publishedRef['page_id'])
  const rowPageId = nonEmptyString(payload['page_id'])
  if (!orderPageId || !rowPageId || orderPageId !== target.page_id || rowPageId !== target.page_id) {
    return { ok: false, status: 409, error: '工单、流量记录与发布目标的主页 id 不一致,不能转公开' }
  }

  const approvedAt = nonEmptyString(reviewRef['approved_at'])
  if (!approvedAt) {
    return { ok: false, status: 409, error: '工单缺少审片通过时间,不能转公开' }
  }

  return { ok: true, row, videoId: orderVideoId, pageId: orderPageId, approvedAt }
}
