/**
 * Drawer utterances that would spend, publish, or write an ad account.
 * A bare "好 / 可以 / 确认" is not a click and not an order.
 * Read-only questions stay on the chat path (PR #3306 owns those tools).
 */

export type SpendKind =
  | 'paused-draft'
  | 'launch'
  | 'raise-budget'
  | 'cut-budget'
  | 'pause'
  | 'publish'
  | 'meta-write'
  | 'spend'

export type DrawerTurn =
  | { readonly kind: 'chat' }
  | { readonly kind: 'affirmation' }
  | { readonly kind: 'spend'; readonly spend: SpendKind; readonly summary: string }

const AFFIRMATION = /^(?:好|好的|可以|确认|行|嗯|同意|ok|okay|yes)[!！。.\s]*$/i

const SPEND_RULES: ReadonlyArray<{ kind: SpendKind; pattern: RegExp }> = [
  { kind: 'paused-draft', pattern: /暂停草稿|草稿(?:并)?送审|建\s*meta\s*草稿|批准建/i },
  { kind: 'launch', pattern: /开投(?!前)|开始投放|上线广告|开启投放/ },
  { kind: 'pause', pattern: /先停|停掉|帮我暂停|把(?:这个|该|那个)?(?:系列|广告|投放)停|暂停(?:这个|该|那个|投放|系列)/ },
  { kind: 'raise-budget', pattern: /加预算|增加预算|预算加|加到\s*\d|提高到\s*\d/ },
  { kind: 'cut-budget', pattern: /减预算|降低预算|降预算|预算降|减到\s*\d/ },
  { kind: 'publish', pattern: /发布广告|帮我发布|现在发布|发出去|发布到/ },
  { kind: 'meta-write', pattern: /改\s*meta|写\s*meta|改广告账户|广告账户里改/i },
  { kind: 'spend', pattern: /花钱|充值|改出价|提高出价|加出价/ },
]

export function clipSummary(text: string): string {
  const cleaned = text
    .replace(/[{}[\]`]/g, ' ')
    .replace(/\d{10,}/g, '数字已略')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return '原话已略'
  return cleaned.length <= 60 ? cleaned : `${cleaned.slice(0, 59)}…`
}

function isQuestion(text: string): boolean {
  return /[？?]\s*$/.test(text) || /了吗/.test(text) || /^(?:为什么|怎么|咋|查|看|读|花了|花费)/.test(text)
}

function isRefusal(text: string): boolean {
  return /不要|先别|^别/.test(text)
}

export function classifyDrawerTurn(text: string): DrawerTurn {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'chat' }
  if (AFFIRMATION.test(trimmed)) return { kind: 'affirmation' }
  if (isQuestion(trimmed) || isRefusal(trimmed)) return { kind: 'chat' }
  const hit = SPEND_RULES.find((rule) => rule.pattern.test(trimmed))
  if (!hit) return { kind: 'chat' }
  return { kind: 'spend', spend: hit.kind, summary: clipSummary(trimmed) }
}

export function textAsksToSpend(value: unknown): boolean {
  if (typeof value === 'string') return classifyDrawerTurn(value).kind === 'spend'
  if (Array.isArray(value)) return value.some(textAsksToSpend)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(textAsksToSpend)
  }
  return false
}
