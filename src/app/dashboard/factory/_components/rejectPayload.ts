import { REEL_HUMAN_CHECK_KEYS_V3, type ContentCheckItemKey, type ContentCheckItemResult } from '@/lib/social/content-review'
import { FACTORY_PUBLISH_BUDGET_HARD_CAP_USD } from '@/lib/factory/constants'

// One-click reject reasons. Keys must all be members of REEL_HUMAN_CHECK_KEYS_V3.
export const REJECT_REASON_LABEL: Partial<Record<ContentCheckItemKey, string>> = {
  subtitle_short_and_large: '字幕太长或太小,看不清',
  asset_provenance_labeled: '素材来源没标注',
  factual_claims_have_source: '文案数字/事实没有来源',
  factual_claims_source_verified: '来源不支持片里的说法',
  viral_recipe_hook_matched: '开头不够抓人',
  safe_zone_text_in_bounds: '文字被平台界面挡住',
  logo_watermark_present: 'Logo 不对或不完整',
  asset_provenance_matches_claim_context: '画面和说的不是一回事(城市/地标/产品)',
  bgm_listened_no_vocals: '背景音乐里有人声',
  standalone_understandable: '单独看不懂在讲什么（要改下单参数：加内容，或明确标成素材；原参数重跑没用）',
}

export const REJECT_REASON_KEYS = Object.keys(REJECT_REASON_LABEL) as ContentCheckItemKey[]

const MAX_FEEDBACK_LEN = 1500

// Build the reject_quality payload from the selected reasons + free text.
export function buildQualityRejectPayload(
  selected: ContentCheckItemKey[],
  freeText: string,
  musicId?: string,
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const picked = selected.filter((key) => REJECT_REASON_KEYS.includes(key))
  if (picked.length === 0) return { ok: false, error: '请至少选一条打回理由' }

  const text = freeText.trim().slice(0, MAX_FEEDBACK_LEN)
  const labels = picked.map((key) => REJECT_REASON_LABEL[key] ?? key).join('；')
  const feedback = text ? `${labels}。补充：${text}` : labels

  const checklist_human: ContentCheckItemResult[] = REEL_HUMAN_CHECK_KEYS_V3.map((key) =>
    picked.includes(key)
      ? { key, judge: 'HUMAN', outcome: 'FAIL', detail: text || REJECT_REASON_LABEL[key] || key, source_ref: null }
      : { key, judge: 'HUMAN', outcome: 'NOT_MEASURED', detail: null, source_ref: null },
  )

  return {
    ok: true,
    payload: {
      action: 'reject_quality',
      feedback,
      checklist_human,
      ...(musicId ? { music_id: musicId } : {}),
    },
  }
}

// Build the reject_budget payload from a raw dollar input string.
export function buildBudgetRejectPayload(
  raw: string,
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = raw.trim()
  const n = Number(trimmed)
  if (!trimmed || Number.isNaN(n) || n <= 0) return { ok: false, error: '请填一个大于 0 的美元数字' }
  if (n > FACTORY_PUBLISH_BUDGET_HARD_CAP_USD) {
    return { ok: false, error: `预算不能超过 $${FACTORY_PUBLISH_BUDGET_HARD_CAP_USD}` }
  }
  return { ok: true, payload: { action: 'reject_budget', new_budget_usd: n } }
}
