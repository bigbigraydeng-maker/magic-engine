/** Per-client switch for the smart auto-ack. Anything but `smart_ack.enabled === true` reads as off. */
export interface SmartAckConfig {
  enabled: boolean
  /** Hard ceiling of smart acks per client per UTC day (cost + blast-radius guard). */
  dailyCap: number
}

export const DEFAULT_SMART_ACK_DAILY_CAP = 300
const MAX_DAILY_CAP = 5000

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readSmartAckConfig(leadsConfig: unknown): SmartAckConfig {
  const off: SmartAckConfig = { enabled: false, dailyCap: DEFAULT_SMART_ACK_DAILY_CAP }
  if (!isPlainObject(leadsConfig)) return off
  const raw = leadsConfig.smart_ack
  if (!isPlainObject(raw)) return off
  const cap = raw.daily_cap
  const dailyCap =
    typeof cap === 'number' && Number.isInteger(cap) && cap > 0 && cap <= MAX_DAILY_CAP
      ? cap
      : DEFAULT_SMART_ACK_DAILY_CAP
  return { enabled: raw.enabled === true, dailyCap }
}
