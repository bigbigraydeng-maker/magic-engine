export type ConfirmationCardCode =
  | 'forbidden'
  | 'invalid'
  | 'stale'
  | 'hard_check'
  | 'not_found'
  | 'rule_blocked'
  | 'not_waiting'

const STATUS: Record<ConfirmationCardCode, number> = {
  forbidden: 403,
  invalid: 400,
  stale: 409,
  hard_check: 409,
  not_found: 404,
  rule_blocked: 409,
  not_waiting: 409,
}

export class ConfirmationCardError extends Error {
  readonly code: ConfirmationCardCode
  readonly status: number
  readonly humanReason: string

  constructor(code: ConfirmationCardCode, humanReason: string) {
    super(humanReason)
    this.name = 'ConfirmationCardError'
    this.code = code
    this.status = STATUS[code]
    this.humanReason = humanReason
  }
}
