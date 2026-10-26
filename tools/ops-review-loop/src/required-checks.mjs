/**
 * Whether every required status check other than this gate is already green.
 *
 * `Risk gate` is required on main and is the check this script is publishing,
 * so counting it would deadlock: the gate could never see itself green before
 * it decides. An empty list after that exclusion, or a rollup we could not
 * read to the end, fails closed.
 */

export const SELF_CHECK_NAME = 'Risk gate'

/**
 * @param {{status?: unknown, conclusion?: unknown}|undefined} check
 * @returns {boolean}
 */
function checkIsGreen(check) {
  return check?.status === 'completed' && check?.conclusion === 'success'
}

/**
 * Prefer the run that finished later. Without a timestamp, a failed run must
 * not be hidden behind a success just because it came first or last.
 *
 * @param {{status?: unknown, conclusion?: unknown, completedAt?: unknown}} current
 * @param {{status?: unknown, conclusion?: unknown, completedAt?: unknown}} next
 */
function preferCheck(current, next) {
  const currentAt = Date.parse(typeof current.completedAt === 'string' ? current.completedAt : '')
  const nextAt = Date.parse(typeof next.completedAt === 'string' ? next.completedAt : '')
  const currentKnown = Number.isFinite(currentAt)
  const nextKnown = Number.isFinite(nextAt)
  if (currentKnown && nextKnown) return nextAt >= currentAt ? next : current
  if (checkIsGreen(current) && checkIsGreen(next)) return current
  return checkIsGreen(current) ? next : current
}

/**
 * @param {{requiredNames?: unknown, checks?: unknown, checksReadable?: unknown}} input
 * @returns {boolean}
 */
export function requiredChecksAreGreen({ requiredNames, checks, checksReadable } = {}) {
  if (checksReadable !== true || !Array.isArray(requiredNames) || !Array.isArray(checks)) return false
  const required = requiredNames.filter((name) => typeof name === 'string' && name !== '' && name !== SELF_CHECK_NAME)
  if (required.length === 0) return false
  /** @type {Map<string, {status?: unknown, conclusion?: unknown, completedAt?: unknown}>} */
  const latest = new Map()
  for (const check of checks) {
    if (!check || typeof check !== 'object') continue
    const row = /** @type {{name?: unknown}} */ (check)
    if (typeof row.name !== 'string' || row.name === '') continue
    const previous = latest.get(row.name)
    latest.set(row.name, previous ? preferCheck(previous, check) : check)
  }
  return required.every((name) => checkIsGreen(latest.get(name)))
}
