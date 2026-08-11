/**
 * Typed error taxonomy for the ME2 orchestrator control plane.
 *
 * Every failure mode that the runner is allowed to act on has its own class, so
 * callers never have to string-match on `error.message` to decide whether a run
 * should halt, wait for a human, or be retried.
 */

export type OrchestratorErrorCode =
  | 'ILLEGAL_TRANSITION'
  | 'POLICY_VIOLATION'
  | 'MISSING_SECRET'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_NOT_WIRED'
  | 'SCHEMA_VALIDATION'
  | 'LEASE_UNAVAILABLE'
  | 'LEDGER_WRITE_BLOCKED'

export class OrchestratorError extends Error {
  readonly code: OrchestratorErrorCode

  constructor(code: OrchestratorErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = new.target.name
  }
}

export class IllegalTransitionError extends OrchestratorError {
  constructor(from: string, to: string) {
    super('ILLEGAL_TRANSITION', `illegal state transition: ${from} -> ${to}`)
  }
}

export class PolicyViolationError extends OrchestratorError {
  readonly offending: readonly string[]

  constructor(message: string, offending: readonly string[] = []) {
    super('POLICY_VIOLATION', message)
    this.offending = offending
  }
}

/** Raised before any network call when a required credential is absent. */
export class MissingSecretError extends OrchestratorError {
  constructor(secretName: string) {
    super('MISSING_SECRET', `required secret is not configured: ${secretName}`)
  }
}

/** Raised when a real provider is constructed while the kill switch keeps it off. */
export class ProviderDisabledError extends OrchestratorError {
  constructor(providerName: string) {
    super('PROVIDER_DISABLED', `provider "${providerName}" is disabled by configuration`)
  }
}

/**
 * Raised when a real provider adapter is invoked in v0.1. The adapters ship as
 * safety skeletons only — they validate configuration and then refuse, so that a
 * misconfigured Enable attempt fails loudly instead of quietly spending money.
 */
export class ProviderNotWiredError extends OrchestratorError {
  constructor(providerName: string) {
    super(
      'PROVIDER_NOT_WIRED',
      `provider "${providerName}" is a scaffold-only skeleton in v0.1 and must not be called`
    )
  }
}

export class SchemaValidationError extends OrchestratorError {
  readonly issues: readonly string[]

  constructor(subject: string, issues: readonly string[]) {
    super('SCHEMA_VALIDATION', `${subject} failed schema validation: ${issues.join('; ')}`)
    this.issues = issues
  }
}

export class LeaseUnavailableError extends OrchestratorError {
  constructor(lockKey: string, heldBy: string) {
    super('LEASE_UNAVAILABLE', `lease "${lockKey}" is already held by ${heldBy}`)
  }
}

/** Raised when a write is attempted through a ledger that is in dry-run/read-only mode. */
export class LedgerWriteBlockedError extends OrchestratorError {
  constructor(reason: string) {
    super('LEDGER_WRITE_BLOCKED', `ledger write blocked: ${reason}`)
  }
}
