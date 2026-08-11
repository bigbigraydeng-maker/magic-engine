/**
 * draft —— 生成候选字段值（Issue #878 / WP06）。
 *
 * 🔴 WP06 不调用模型：`proposedValue` 必须由调用方（Domain Module / WP05）
 *    在 `PageOptimizationRequest.intents` 里给出。draft 做的是「确定性准备」——
 *    拿这些值去核对快照（这一页结构上撑不撑得住这次改动），不是「想」出内容
 *    （2026-08-11 实施指令第 4 条）。
 * 🔴 不发网络请求、不调 provider 客户端——只处理已经取回的 `PageSnapshot`。
 * 🔴 GitHub 静态页场景 facade 复用既有的 `patchStaticHtmlPage`，不重新实现
 *    它的校验逻辑（不完整 HTML 文档 / 缺 `<title>` / 托管内容块标记不成对
 *    这几条判据全部原样继承）；**不 import、不调用 `publishPageUpgradeToGithub`**
 *    ——那个函数把 snapshot/draft/apply 揉在一起，是本次要 facade 掉的反例。
 */

import { patchStaticHtmlPage, MANAGED_CONTENT_START, MANAGED_CONTENT_END } from '@/lib/cms/static-html-page-upgrade'
import { PAGE_OPTIMIZATION_FIELDS } from './types'
import type {
  GithubPageSnapshot,
  PageDraftField,
  PageDraftResult,
  PageOptimizationField,
  PageOptimizationIntent,
  PageSnapshot,
} from './types'

/**
 * 从 GitHub 静态页原始 HTML 里只读地取出某个字段的当前值。
 *
 * 镜像 `static-html-page-upgrade.ts` 里私有的 `replaceTitle` /
 * `replaceMetaDescription` 的读取半段——那两个函数没有导出只读版本，
 * 这里补一个只读实现（不复制它们的写入逻辑）。取不到就返回 null，
 * 调用方必须把它当成「定位不到」而不是「空字符串」。
 */
export function extractGithubFieldValue(
  rawContent: string,
  field: PageOptimizationField,
): string | null {
  switch (field) {
    case 'meta_title': {
      const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(rawContent)
      return match ? decodeHtmlEntities(match[1].trim()) : null
    }
    case 'meta_description': {
      const tags = rawContent.match(/<meta\b[^>]*>/gi) ?? []
      const tag = tags.find((t) => /\bname\s*=\s*(['"])description\1/i.test(t))
      if (!tag) return null
      const match = /\bcontent\s*=\s*(['"])([\s\S]*?)\1/i.exec(tag)
      return match ? decodeHtmlEntities(match[2]) : null
    }
    case 'content_html': {
      const start = rawContent.indexOf(MANAGED_CONTENT_START)
      const end = rawContent.indexOf(MANAGED_CONTENT_END)
      if (start === -1 || end === -1 || end <= start) return null
      return rawContent.slice(start + MANAGED_CONTENT_START.length, end).trim()
    }
  }
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/**
 * 校验意图集合：只认 v1 冻结的三个字段，且每个字段最多出现一次。
 *
 * 🔴 `proposedValue` 必须在运行时核实真的是字符串——`PageOptimizationIntent`
 *    的类型标注挡不住跨 JSON 边界传入 `undefined`/数字/`null` 这种畸形值
 *    （`JSON.stringify({ a: undefined })` 会悄悄把这个 key 整个丢掉，产出
 *    一份看似成功、实则不是 JSON-safe 的结果——2026-08-11 Build Control Room
 *    PATCH REQUIRED 复审第 3 条）。
 */
function validateIntents(
  intents: readonly PageOptimizationIntent[],
): { readonly ok: true; readonly byField: ReadonlyMap<PageOptimizationField, string> } | { readonly ok: false; readonly reason: string } {
  const byField = new Map<PageOptimizationField, string>()
  for (const intent of intents) {
    if (!(PAGE_OPTIMIZATION_FIELDS as readonly string[]).includes(intent.field)) {
      return {
        ok: false,
        reason: `字段 "${intent.field}" 不在 v1 允许的字段集合内（meta_title | meta_description | content_html）`,
      }
    }
    if (typeof intent.proposedValue !== 'string') {
      return {
        ok: false,
        reason: `字段 "${intent.field}" 的 proposedValue 必须是字符串（收到的不是——畸形跨 JSON 边界输入）`,
      }
    }
    if (byField.has(intent.field)) {
      return { ok: false, reason: `字段 "${intent.field}" 出现了不止一次意图，存在歧义` }
    }
    byField.set(intent.field, intent.proposedValue)
  }
  if (byField.size === 0) {
    return { ok: false, reason: '请求没有携带任何字段意图，没有可起草的内容' }
  }
  return { ok: true, byField }
}

function draftForGithub(
  snapshot: GithubPageSnapshot,
  byField: ReadonlyMap<PageOptimizationField, string>,
): PageDraftResult {
  // patchStaticHtmlPage 的 metaTitle/metaDescription 是必填参数——没被这次
  // 意图动到的字段要把「当前值」原样带进去，否则会被当成清空。这也是唯一
  // 需要读「改之前是什么」的地方；diff 阶段会再独立读一次，两处不共享状态。
  const metaTitle = byField.get('meta_title') ?? extractGithubFieldValue(snapshot.rawContent, 'meta_title')
  const metaDescription =
    byField.get('meta_description') ?? extractGithubFieldValue(snapshot.rawContent, 'meta_description')

  if (metaTitle === null || metaDescription === null) {
    return { ok: false, reason: '目标页面缺少可识别的 <title> 或 meta description，无法安全起草。' }
  }

  const htmlBody = byField.get('content_html')
  const patch = patchStaticHtmlPage(snapshot.rawContent, {
    metaTitle,
    metaDescription,
    ...(htmlBody !== undefined ? { htmlBody } : {}),
  })
  if (!patch.ok) {
    return { ok: false, reason: patch.reason }
  }

  const fields: PageDraftField[] = Array.from(byField.entries()).map(([field, value]) => ({ field, value }))
  return { ok: true, fields }
}

function draftForWordpress(byField: ReadonlyMap<PageOptimizationField, string>): PageDraftResult {
  // WordPress 的三个目标字段（Yoast title / Yoast description / content）各自
  // 独立可写，没有 static-html 那种「必须同时提交两项」的耦合，直接透传即可。
  const fields: PageDraftField[] = Array.from(byField.entries()).map(([field, value]) => ({ field, value }))
  return { ok: true, fields }
}

/**
 * 起草。要求快照必须可用——WP00 Page 契约 §3.2：「快照失败 = 不许继续」，
 * 起草同样不许在没有 before 的情况下进行。
 */
export function draftPageChange(
  snapshot: PageSnapshot,
  intents: readonly PageOptimizationIntent[],
): PageDraftResult {
  if (!snapshot.ok) {
    return {
      ok: false,
      reason: `快照不可用（${snapshot.provider}）：${snapshot.reason}，不能在没有快照的情况下起草。`,
    }
  }

  const validated = validateIntents(intents)
  if (!validated.ok) return validated

  return snapshot.provider === 'github'
    ? draftForGithub(snapshot, validated.byField)
    : draftForWordpress(validated.byField)
}
