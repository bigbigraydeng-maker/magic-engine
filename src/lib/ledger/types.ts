export type LedgerStatus = 'decided' | 'done' | 'verified' | 'failed'
export type LedgerOwner = 'pm' | 'agent'

export const LEDGER_STATUSES: readonly LedgerStatus[] = ['decided', 'done', 'verified', 'failed']
export const LEDGER_OWNERS: readonly LedgerOwner[] = ['pm', 'agent']

/** 每个指向字段允许的写法（魏征/子牙复审：done_ref 不许 url/session，防"随手贴个链接"糊弄） */
export const REF_KINDS_BY_FIELD = {
  source: ['session', 'pr', 'issue', 'doc'],
  done_ref: ['pr', 'commit', 'doc'],
  verified_ref: ['pr', 'commit', 'doc', 'url'],
} as const

export interface LedgerEntry {
  /** 等于文件名去掉 .md */
  id: string
  title: string
  status: LedgerStatus
  owner: LedgerOwner
  /** YYYY-MM-DD */
  decidedOn: string
  /** session:<id> | pr:<n> | issue:<n> | doc:<path> */
  source: string
  /** YYYY-MM-DD，可选 */
  verifyBy: string | null
  verifyHow: string
  /** status 为 done/verified/failed 时必填 */
  doneOn: string | null
  doneRef: string | null
  /** status 为 verified/failed 时必填 */
  verifiedRef: string | null
  /** 夜巡最近一次核查日期 YYYY-MM-DD，可选 */
  lastChecked: string | null
  /** 核查结论或"为什么判不了"，可选 */
  checkNote: string | null
  body: string
}

export interface LedgerParseError {
  file: string
  reason: string
}

export type LedgerParseResult =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; error: LedgerParseError }
