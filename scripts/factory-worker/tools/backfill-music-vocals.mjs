// READ-ONLY backfill tool: proposes music-vocal registry entries from PM-approved
// published work orders. Never writes to the DB; only optionally writes --out JSON.

import { readFileSync, existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMusicVocalRegistry, sha256File } from '../music-vocal-gate.mjs'

// The ONLY approvers whose approval counts.
export const PM_EMAILS = ['bigbigraydeng@gmail.com']

const CHECKLIST_KEY = 'resolution_aspect_ratio_correct'
const MEASURED_RE = /Measured\s+\d+×\d+,\s*([0-9.]+)s/

// Parse measured seconds from the resolution/aspect checklist item detail.
export function measuredSecondsFromChecklist(output) {
  const items = output?.quality_checklist_auto
  if (!Array.isArray(items)) return null
  const item = items.find((it) => it && it.key === CHECKLIST_KEY)
  if (!item || typeof item.detail !== 'string') return null
  const m = item.detail.match(MEASURED_RE)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}

function isValidIso(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v))
}

// Decide whether an order qualifies and extract its music window.
function classifyOrder(order) {
  if (!order || typeof order !== 'object') return { skip: 'invalid order' }
  if (order.status !== 'published') return { skip: 'not published' }
  const approvedBy = order.review_ref?.approved_by
  if (!PM_EMAILS.includes(approvedBy)) return { skip: 'not PM-approved' }
  const props = order.brief?.remotion?.props
  const musicFile = props?.musicFile
  if (!isNonEmptyString(musicFile)) return { skip: 'no musicFile' }
  const durationSec = measuredSecondsFromChecklist(order.output)
  if (durationSec === null) return { skip: 'no measured duration' }
  const startSec = props.musicStartSec ?? 0
  if (typeof startSec !== 'number' || !Number.isFinite(startSec) || startSec < 0) {
    return { skip: 'invalid musicStartSec' }
  }
  return { musicFile, startSec, durationSec }
}

// Build the registry entry for one sha group.
function buildEntry(group, existingRegistry) {
  const { sha256, orders } = group
  const existing = existingRegistry.find((e) => e.sha256 === sha256)
  const orderIds = orders.map((o) => o.id)
  const name = orders[0].musicFile
  if (existing) {
    if (existing.verdict === 'present') {
      return { conflict: { sha256, name, orderIds } }
    }
    return { skip: 'already registered' }
  }
  // Latest-approved order drives signedBy/signedAt.
  const latest = orders.reduce((a, b) =>
    Date.parse(b.approvedAt) >= Date.parse(a.approvedAt) ? b : a)
  if (!isValidIso(latest.approvedAt)) return { skip: 'invalid approved_at' }
  const windowEnd = Math.max(...orders.map((o) => o.startSec + o.durationSec))
  const cleanUntilSec = Math.ceil(windowEnd) + 1
  const ids8 = orderIds.map((id) => String(id).slice(0, 8)).join(',')
  const entry = {
    sha256,
    name,
    verdict: 'none',
    cleanUntilSec,
    strength: 'approval-only',
    signedBy: `PM审片@${String(latest.id).slice(0, 8)}`,
    signedAt: latest.approvedAt,
    evidence: `approved published orders ${ids8}; machine transcripts (small + large-v3-turbo) in evidence pack 2026-10-16-tale-vocals`,
  }
  return { entry, windowEnd, cleanUntilSec, orderIds }
}

// Propose registry entries from work orders. All IO is injected.
export async function proposeRegistryEntries({
  orders,
  existingRegistry,
  locateFileFn,
  shaFn,
}) {
  const entries = []
  const rows = []
  const conflicts = []
  const skipped = []
  const groups = new Map()

  for (const order of orders ?? []) {
    const c = classifyOrder(order)
    if (c.skip) {
      skipped.push({ id: order?.id, reason: c.skip })
      continue
    }
    const path = locateFileFn(c.musicFile)
    if (!path) {
      skipped.push({ id: order.id, reason: 'music file not found' })
      continue
    }
    const sha256 = await shaFn(path)
    const approvedAt = order.review_ref?.approved_at
    const rec = {
      id: order.id,
      musicFile: c.musicFile,
      startSec: c.startSec,
      durationSec: c.durationSec,
      approvedAt,
    }
    if (!groups.has(sha256)) groups.set(sha256, { sha256, orders: [] })
    groups.get(sha256).orders.push(rec)
  }

  for (const group of groups.values()) {
    const built = buildEntry(group, existingRegistry)
    const sha8 = group.sha256.slice(0, 8)
    const orderIds8 = group.orders.map((o) => String(o.id).slice(0, 8)).join(',')
    if (built.conflict) {
      conflicts.push(built.conflict)
      rows.push({
        musicFile: group.orders[0].musicFile,
        sha8,
        orderIds8,
        windowEndSec: null,
        cleanUntilSec: null,
        result: 'CONFLICT: vocal track in approved video',
      })
      continue
    }
    if (built.skip) {
      rows.push({
        musicFile: group.orders[0].musicFile,
        sha8,
        orderIds8,
        windowEndSec: null,
        cleanUntilSec: null,
        result: 'already registered',
      })
      continue
    }
    entries.push(built.entry)
    rows.push({
      musicFile: group.orders[0].musicFile,
      sha8,
      orderIds8,
      windowEndSec: built.windowEnd,
      cleanUntilSec: built.cleanUntilSec,
      result: 'proposed',
    })
  }

  // Fail-closed: validate the combined registry before returning.
  parseMusicVocalRegistry([...(existingRegistry ?? []), ...entries])
  return { entries, rows, conflicts, skipped }
}

// Render the human-readable markdown table.
export function formatRowsTable(rows) {
  const header = '| musicFile | sha8 | orderIds | windowEndSec | cleanUntilSec | result |'
  const sep = '| --- | --- | --- | --- | --- | --- |'
  const lines = (rows ?? []).map((r) => {
    const we = r.windowEndSec === null ? '' : r.windowEndSec
    const cu = r.cleanUntilSec === null ? '' : r.cleanUntilSec
    return `| ${r.musicFile} | ${r.sha8} | ${r.orderIds8} | ${we} | ${cu} | ${r.result} |`
  })
  return [header, sep, ...lines].join('\n')
}

// Default file locator: search known asset roots in order.
export function makeLocateFileFn(studioRoot) {
  return (musicFile) => {
    const candidates = [
      join(studioRoot, 'CTS/remotion-assets', musicFile),
      join(studioRoot, 'East_Inter/remotion-assets', musicFile),
      join(studioRoot, '_shared/music', basename(musicFile)),
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    return null
  }
}

// Fetch published work orders from Supabase REST (read-only).
async function fetchOrders(url, key) {
  const endpoint = `${url}/rest/v1/content_work_orders?select=id,status,brief,output,review_ref&status=eq.published&limit=1000`
  const res = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`Supabase fetch failed: HTTP ${res.status}`)
  return res.json()
}

function parseArgs(argv) {
  const args = { out: null, registry: null, studioRoot: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i]
    else if (a === '--registry') args.registry = argv[++i]
    else if (a === '--studio-root') args.studioRoot = argv[++i]
  }
  return args
}

// CLI entry point.
export async function main(argv, env, io) {
  const args = parseArgs(argv)
  const here = dirname(fileURLToPath(import.meta.url))
  const registryPath = args.registry ?? resolve(here, '../engines/remotion/catalog/music-vocals.json')
  const studioRoot = args.studioRoot ?? process.cwd()

  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    io.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return 1
  }

  const existingRegistry = parseMusicVocalRegistry(
    JSON.parse(readFileSync(registryPath, 'utf8')),
  )
  const orders = await fetchOrders(url, key)
  const { entries, rows, conflicts, skipped } = await proposeRegistryEntries({
    orders,
    existingRegistry,
    locateFileFn: makeLocateFileFn(studioRoot),
    shaFn: sha256File,
  })

  io.log(formatRowsTable(rows))
  if (conflicts.length > 0) {
    io.log(`\nCONFLICT: ${conflicts.length} sha(s) already registered as vocal-present but used in approved videos:`)
    for (const c of conflicts) {
      io.log(`  CONFLICT ${c.sha256} (${c.name}) orders: ${c.orderIds.join(',')}`)
    }
  }
  io.log(`\nskipped: ${skipped.length}`)

  if (args.out) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(args.out, JSON.stringify(entries, null, 2))
    io.log(`wrote ${entries.length} entries to ${args.out}`)
  }

  return conflicts.length > 0 ? 2 : 0
}

// Only run when executed directly.
const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main(process.argv.slice(2), process.env, console)
    .then((code) => { process.exitCode = code })
    .catch((err) => { console.error(err); process.exitCode = 1 })
}
