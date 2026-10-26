// Reel 授权后单条转公开(受控动作)— 纯函数护栏。
// 设计稿:docs/specs/2026-10-18-reel-promote-to-public-design-v0.2.md
// 本文件只放纯函数:无网络、无数据库、无时钟、无随机。所有外部依赖由调用方注入。
// 目的:把「能不能转公开」的判断集中到一处,便于单测穷举,也便于 fail-closed 审计。

import { createHash, timingSafeEqual } from 'node:crypto'
import {
  REEL_AUTO_CHECK_KEYS,
  checklistPasses,
  humanKeysForReviewRef,
  validateContentChecklist,
} from '@/lib/social/content-review'
import type { PublishTarget } from '../../types'
import { portFor } from './platform-port'
import { asRecord, nonEmptyString } from './record'
import type { PromoteOrder, TrafficRow } from './types'

export { asRecord }

// ── 文本归一化 ────────────────────────────────────────────────────────────────

/**
 * 去掉不可见/组合类字符。红线绕过最常见的手法就是往词里塞不可见字符,
 * 让「品牌名」在肉眼看来一模一样、在字符串比较里却不同。
 * 覆盖:
 *  - \p{Cf} 格式字符(零宽空格/连接符、方向控制符、U+FEFF、U+00AD 等);
 *  - \p{Mn} 非间距组合标记(如 U+034F 组合用字形连接符、变体选择符等);
 *  - 韩文填充字符(U+3164、U+115F、U+1160、U+FFA0),肉眼不可见但会破坏比较。
 */
export function stripInvisible(s: string): string {
  return s.replace(/[\p{Cf}\p{Mn}\u3164\u115F\u1160\uFFA0]/gu, '')
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

// ── 前置检查 ──────────────────────────────────────────────────────────────────

export type PrecheckResult =
  | { ok: true; row: TrafficRow; videoId: string; pageId: string; approvedAt: string }
  | { ok: false; status: number; error: string }

/** 发布目标:找不到对应平台端口一律按「目标不可用」拒绝;具体规则由平台端口决定。 */
function checkTarget(target: PublishTarget | null): PrecheckResult | null {
  const port = target ? portFor(target.platform) : null
  const failure = port ? port.checkTarget(target) : { status: 422, error: '发布目标未配置或不是 Facebook 主页,不能转公开' }
  return failure ? { ok: false, ...failure } : null
}

/** 工单状态:已发布、Reel 处于 DRAFT、且带 master_brief_id。 */
function checkOrderState(order: PromoteOrder): PrecheckResult | null {
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
  return null
}

/** 审片清单:人工清单与自动清单都必须存在、完整且全部通过。 */
function checkChecklists(order: PromoteOrder): PrecheckResult | null {
  const reviewRef = asRecord(order.review_ref)
  const output = asRecord(order.output)
  const humanChecklist = validateContentChecklist(
    reviewRef['checklist_human'],
    humanKeysForReviewRef(reviewRef),
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
  return null
}

/** 流量记录:必须恰好一条,否则无法确定转哪一条。 */
function checkRows(rows: TrafficRow[]): PrecheckResult | null {
  if (rows.length === 0) {
    return { ok: false, status: 409, error: '找不到该工单的发布流量记录,不能转公开' }
  }
  if (rows.length > 1) {
    return { ok: false, status: 409, error: '该工单有多条发布流量记录,无法确定转哪一条,不能转公开' }
  }
  return null
}

/**
 * 数据一致性:工单、流量记录、发布目标三方的视频 id / 账号 id 必须一致(由平台端口检查),
 * 且工单带有审片通过时间。成功时返回收窄后的成功结果。
 */
function checkIds(
  order: PromoteOrder,
  row: TrafficRow,
  target: PublishTarget,
): PrecheckResult {
  const port = portFor(target.platform)
  if (!port) return { ok: false, status: 422, error: '发布目标未配置或不是 Facebook 主页,不能转公开' }
  const ids = port.checkIds(order, row, target)
  if (!ids.ok) return ids

  const reviewRef = asRecord(order.review_ref)
  const approvedAt = nonEmptyString(reviewRef['approved_at'])
  if (!approvedAt) {
    return { ok: false, status: 409, error: '工单缺少审片通过时间,不能转公开' }
  }

  return { ok: true, row, videoId: ids.videoId, pageId: ids.accountId, approvedAt }
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

  const targetFailure = checkTarget(target)
  if (targetFailure) return targetFailure

  const stateFailure = checkOrderState(order)
  if (stateFailure) return stateFailure

  const checklistFailure = checkChecklists(order)
  if (checklistFailure) return checklistFailure

  const rowsFailure = checkRows(rows)
  if (rowsFailure) return rowsFailure

  // 到这里 target 已通过 checkTarget 收窄,rows 恰好一条。
  return checkIds(order, rows[0], target as PublishTarget)
}
