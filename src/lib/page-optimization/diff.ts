/**
 * diff —— 人可评审的字段级改动（Issue #878 / WP06）。
 *
 * 🔴 字段级、仅此四项：`field + before + after + changed`。不做段落 diff /
 *    行级 diff / 引入 diff 依赖 / HTML 可视化 diff（2026-08-11 实施指令第 6 条）。
 * 🔴 输入固定则确定性——同一份 snapshot + 同一份 draft，两次调用产出逐字节
 *    相同的结果。
 * 🔴 「定位不到某个字段的 before 值」不许被悄悄当成空字符串——那会把「真的
 *    有值但我们没读到」误报成「本来就是空的」，diff 直接判失败而不是猜。
 */

import { extractGithubFieldValue } from './draft'
import type {
  GithubPageSnapshot,
  PageDiffResult,
  PageDraftResult,
  PageFieldDiff,
  PageOptimizationField,
  PageSnapshot,
  WordpressPageSnapshot,
} from './types'

function readBeforeValue(
  snapshot: GithubPageSnapshot | WordpressPageSnapshot,
  field: PageOptimizationField,
): string | null {
  if (snapshot.provider === 'github') {
    return extractGithubFieldValue(snapshot.rawContent, field)
  }
  switch (field) {
    case 'meta_title':
      return snapshot.rawFields.seoTitle
    case 'meta_description':
      return snapshot.rawFields.seoDescription
    case 'content_html':
      return snapshot.rawFields.content
  }
}

export function diffPageChange(snapshot: PageSnapshot, draft: PageDraftResult): PageDiffResult {
  if (!snapshot.ok) {
    return { ok: false, reason: `快照不可用（${snapshot.provider}）：${snapshot.reason}` }
  }
  if (!draft.ok) {
    return { ok: false, reason: `草稿不可用：${draft.reason}` }
  }

  const changes: PageFieldDiff[] = []
  for (const { field, value: after } of draft.fields) {
    const before = readBeforeValue(snapshot, field)
    if (before === null) {
      return { ok: false, reason: `字段 "${field}" 在当前页面中定位不到，无法生成可信的 diff。` }
    }
    changes.push({ field, before, after, changed: before !== after })
  }

  return { ok: true, changes }
}
