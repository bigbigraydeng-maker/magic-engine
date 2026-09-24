export type LedgerRefKind = 'pr' | 'issue' | 'commit' | 'doc' | 'session' | 'url'

export interface LedgerRef {
  kind: LedgerRefKind
  value: string
}

/** 人话说明，报错时原样给出 */
export const LEDGER_REF_HELP = 'pr:123 / issue:123 / commit:abc1234 / doc:docs/xx.md / session:abcd1234 / url:https://…'

const RULES: Record<LedgerRefKind, RegExp> = {
  pr: /^[1-9]\d*$/,
  issue: /^[1-9]\d*$/,
  commit: /^[0-9a-f]{7,40}$/,
  doc: /^[A-Za-z0-9_.\/-]+$/,
  session: /^[0-9a-f-]{8,}$/,
  url: /^https?:\/\/\S+$/,
}

const KINDS = Object.keys(RULES) as LedgerRefKind[]

function isKind(kind: string): kind is LedgerRefKind {
  return (KINDS as string[]).includes(kind)
}

export function parseRef(raw: string): LedgerRef | null {
  const trimmed = raw.trim()
  const sep = trimmed.indexOf(':')
  if (sep === -1) return null

  const kind = trimmed.slice(0, sep)
  const value = trimmed.slice(sep + 1)
  if (value === '') return null
  if (!isKind(kind)) return null
  if (!RULES[kind].test(value)) return null

  // doc 额外禁止绝对路径与 .. 穿越，正则本身拦不住
  if (kind === 'doc' && (value.startsWith('/') || value.includes('..'))) return null

  return { kind, value }
}
