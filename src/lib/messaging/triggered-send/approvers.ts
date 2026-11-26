/**
 * Who may AUTHORIZE the welcome letter: an exact list, `TRIGGERED_SEND_APPROVER_EMAILS` (the PM himself; he must also be
 * a global administrator, the door of every authorization endpoint). Not set or empty = nobody, never a fall-back to
 * the admin list, which has several people (§4.3 "authorize: the PM himself only", like the ad-spend approver list).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3 (plan: §17.2).
 */

export const APPROVER_ENV = 'TRIGGERED_SEND_APPROVER_EMAILS'

export type EnvReader = (name: string) => string | undefined

export function readApprovers(env: EnvReader): string[] {
  return (env(APPROVER_ENV) ?? '')
    .split(',')
    .map((e) => e.toLowerCase().trim())
    .filter((e) => e.length > 0)
}

/** Exact, case-insensitive; not configured = nobody (fail closed). */
export function isTriggeredSendApprover(email: string, env: EnvReader = (n) => process.env[n]): boolean {
  const normalised = email.toLowerCase().trim()
  return normalised !== '' && readApprovers(env).includes(normalised)
}
