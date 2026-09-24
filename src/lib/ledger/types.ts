export type LedgerStatus = 'decided' | 'done' | 'verified' | 'failed'
export type LedgerOwner = 'pm' | 'agent'

export const LEDGER_STATUSES: readonly LedgerStatus[] = ['decided', 'done', 'verified', 'failed']
export const LEDGER_OWNERS: readonly LedgerOwner[] = ['pm', 'agent']

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
  body: string
}

export interface LedgerParseError {
  file: string
  reason: string
}

export type LedgerParseResult =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; error: LedgerParseError }
