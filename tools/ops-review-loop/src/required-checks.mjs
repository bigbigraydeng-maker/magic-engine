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
 * @param {{requiredNames?: unknown, checks?: unknown, checksReadable?: unknown}} input
 * @returns {boolean}
 */
export function requiredChecksAreGreen({ requiredNames, checks, checksReadable } = {}) {
  if (checksReadable !== true || !Array.isArray(requiredNames) || !Array.isArray(checks)) return false
  const required = requiredNames.filter((name) => typeof name === 'string' && name !== '' && name !== SELF_CHECK_NAME)
  if (required.length === 0) return false
  /** @type {Map<string, {status?: unknown, conclusion?: unknown}>} */
  const latest = new Map()
  for (const check of checks) {
    if (!check || typeof check !== 'object') continue
    const row = /** @type {{name?: unknown}} */ (check)
    if (typeof row.name !== 'string' || row.name === '') continue
    latest.set(row.name, /** @type {{status?: unknown, conclusion?: unknown}} */ (check))
  }
  return required.every((name) => {
    const check = latest.get(name)
    return check?.status === 'completed' && check?.conclusion === 'success'
  })
}
