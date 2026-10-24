/** Shared contracts for the smart auto-ack (design: docs/specs/2026-10-22-smart-ack-design-v0.md §9). */

export const AUTOMATED_NOTICE = '(Automated reply — our team will follow up personally.)'

export type TriageReason =
  | 'triage_complaint'
  | 'triage_optout'
  | 'triage_promise'
  | 'triage_no_text'
  | 'triage_too_short'
  | 'triage_link_only'
  | 'triage_non_english'

export type TriageResult = { useModel: true } | { useModel: false; reason: TriageReason }

export type ValidateReason =
  | 'validate_empty'
  | 'validate_length'
  | 'validate_forbidden'
  | 'validate_number'
  | 'validate_link_contact'
  | 'validate_identity'
  | 'validate_echo'
  | 'validate_language'

export type ValidateResult = { ok: true; text: string } | { ok: false; reason: ValidateReason }
