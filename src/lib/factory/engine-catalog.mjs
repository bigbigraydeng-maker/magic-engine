// Shared contract between the render machine and the server.
// The machine reports this on claim, ping, and delivery. The server refuses a
// new claim when the report is missing or behind this catalog. No database column:
// the revision is stored later on the existing work-order output object.

export const ENGINE_CATALOG_ID = '2026-10-28'

export const REQUIRED_ENGINE_CAPABILITIES = ['hook_v2', 'end_card_v2', 'encode_cap']

export const ENGINE_UPDATE_MESSAGE =
  '出片机版本过旧。在你那台 Mac 的出片机文件夹里：先拉取最新代码，再切到刚合进主干的那次提交，然后重启出片机（launchctl kickstart -k gui/$(id -u)/com.magicengine.factory-worker）。队列里的单子还在，不会作废；这台旧机器先不接新单，重启后会继续做。'

const SHA = /^[0-9a-f]{40}$/

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, engine_rev: string, catalog_id: string, capabilities: string[] } | { ok: false, message: string, engine_rev: string | null }}
 */
export function assessEngineReport(raw) {
  const record = asRecord(raw)
  const rev = typeof record?.engine_rev === 'string' ? record.engine_rev.trim().toLowerCase() : ''
  const catalog = typeof record?.catalog_id === 'string' ? record.catalog_id.trim() : ''
  const caps = Array.isArray(record?.capabilities)
    ? record.capabilities.filter((item) => typeof item === 'string')
    : []
  const missing = REQUIRED_ENGINE_CAPABILITIES.filter((item) => !caps.includes(item))
  const shaOk = SHA.test(rev)
  if (!shaOk || catalog !== ENGINE_CATALOG_ID || missing.length > 0) {
    return { ok: false, message: ENGINE_UPDATE_MESSAGE, engine_rev: shaOk ? rev : null }
  }
  return {
    ok: true,
    engine_rev: rev,
    catalog_id: catalog,
    capabilities: [...REQUIRED_ENGINE_CAPABILITIES],
  }
}

/**
 * Plain-language notice when every relevant alive-ping says the machine is old.
 * A second machine that already reports the current catalog suppresses the notice.
 * @param {readonly { summary?: { client_ids?: string[] | null, engine_stale?: boolean, engine_notice?: string } | null }[]} pings
 * @param {string} [clientId]
 * @returns {string | null}
 */
export function engineStaleNotice(pings, clientId) {
  const id = typeof clientId === 'string' ? clientId.toLowerCase() : ''
  const notes = []
  let fresh = false
  for (const ping of pings) {
    const summary = asRecord(ping?.summary)
    if (!summary) continue
    if (id) {
      const ids = Array.isArray(summary.client_ids) ? summary.client_ids : []
      if (!ids.some((item) => typeof item === 'string' && item.toLowerCase() === id)) continue
    }
    if (summary.engine_stale === false) fresh = true
    else if (summary.engine_stale === true) {
      notes.push(typeof summary.engine_notice === 'string' && summary.engine_notice.trim()
        ? summary.engine_notice.trim()
        : ENGINE_UPDATE_MESSAGE)
    }
  }
  if (fresh || notes.length === 0) return null
  return notes[0]
}

/** Card line for a finished video that was rendered by an old machine. */
export function engineCardNote(output) {
  const record = asRecord(output)
  if (!record || record.engine_stale !== true) return null
  return ENGINE_UPDATE_MESSAGE
}
