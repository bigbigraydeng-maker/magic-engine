/**
 * The "armed" switch of an unattended sender: whether code that sends on its own (no person clicking) may act for one
 * client. Shared by new senders; the two older copies (daily-plan auto-publish, story-lite) stay as they are until a
 * separate clean-up.
 *
 * Arming is not the brake. The brake is revoking the standing authorization in the database (checked before every
 * single send). An environment change on Render does not redeploy by itself, so switching it off is not an emergency
 * stop either; it only keeps a sender from starting.
 *
 * Fail closed, on purpose:
 *  - `live` must be exactly the string `true` (`TRUE`, `1`, ` true`, `yes` all leave it off): a typo in a deploy
 *    setting must never arm a sender.
 *  - the client must be on the comma-separated allow-list; an empty list arms nobody, even when `live` is on.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3 (plan: §17).
 */

export type EnvReader = (name: string) => string | undefined

export interface LiveSwitchNames {
  /** e.g. `TRIGGERED_SEND_LIVE` */
  live: string
  /** e.g. `TRIGGERED_SEND_CLIENTS` */
  clients: string
}

export interface LiveSwitches {
  live: boolean
  clientIds: string[]
}

export const TRIGGERED_SEND_SWITCHES: Readonly<LiveSwitchNames> = {
  live: 'TRIGGERED_SEND_LIVE',
  clients: 'TRIGGERED_SEND_CLIENTS',
}

export function readLiveSwitches(names: LiveSwitchNames, env: EnvReader): LiveSwitches {
  const live = env(names.live) === 'true'
  const clientIds = (env(names.clients) ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
  return { live, clientIds }
}

/** Both switches must agree: the global flag and the client's place on the allow-list. */
export function isLiveFor(switches: LiveSwitches, clientId: string): boolean {
  if (!switches.live) return false
  return switches.clientIds.includes(clientId.trim().toLowerCase())
}
