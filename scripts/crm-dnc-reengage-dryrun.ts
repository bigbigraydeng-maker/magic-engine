/**
 * Local-only dry-run for the "客人自己回来找我们" auto-clear.
 *
 * Prints what `decideReengageClear` WOULD do for a batch of contacts. It never
 * writes anything, never touches the network, env, or supabase — it just reads
 * a JSON file and prints a table. Ids are truncated to the first 8 chars; no
 * names or message bodies are printed.
 *
 * Usage:
 *   npx tsx scripts/crm-dnc-reengage-dryrun.ts <path-to-json>
 *
 * Input JSON shape:
 *   [{ contactId: string, input: ReengageInput }, ...]
 */

import { readFileSync } from 'node:fs'
import { decideReengageClear, type ReengageInput } from '../src/lib/crm/dnc-reengage'

const NZ_FORMAT = new Intl.DateTimeFormat('en-NZ', {
  timeZone: 'Pacific/Auckland',
  dateStyle: 'medium',
  timeStyle: 'short',
})

function isRow(x: unknown): x is { contactId: string; input: ReengageInput } {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  if (typeof r.contactId !== 'string') return false
  const input = r.input
  if (typeof input !== 'object' || input === null) return false
  const i = input as Record<string, unknown>
  if (typeof i.contactFlag !== 'boolean') return false
  if (!Array.isArray(i.touches)) return false
  if (!Array.isArray(i.inboundMessages)) return false
  return true
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function fmtNz(iso: string | null | undefined): string {
  if (!iso) return '-'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '-'
  return NZ_FORMAT.format(new Date(t))
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

function main(): void {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: npx tsx scripts/crm-dnc-reengage-dryrun.ts <path-to-json>')
    process.exit(2)
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    console.error(`error: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error(`error: invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }

  if (!Array.isArray(parsed)) {
    console.error('error: top-level JSON must be an array of { contactId, input }')
    process.exit(2)
  }

  const rows: { contactId: string; input: ReengageInput }[] = []
  for (let idx = 0; idx < parsed.length; idx++) {
    const item: unknown = parsed[idx]
    if (!isRow(item)) {
      console.error(`error: item at index ${idx} is not a valid { contactId, input } row`)
      process.exit(2)
    }
    rows.push(item)
  }

  const headers = ['contact', 'decision', 'why/trigger', 'trigger at (NZ)', 'dnc at (NZ)']
  const table: string[][] = []

  let wouldClear = 0
  const whyCounts: Record<string, number> = {}

  for (const row of rows) {
    const decision = decideReengageClear(row.input)
    if (decision.clear) {
      wouldClear++
      table.push([
        shortId(row.contactId),
        'CLEAR',
        decision.trigger.kind,
        fmtNz(decision.trigger.at),
        fmtNz(decision.dncAt),
      ])
    } else {
      whyCounts[decision.why] = (whyCounts[decision.why] ?? 0) + 1
      table.push([shortId(row.contactId), 'keep', decision.why, '-', '-'])
    }
  }

  const widths = headers.map((h, col) =>
    table.reduce((w, r) => Math.max(w, r[col].length), h.length),
  )

  const line = (cells: string[]): string =>
    cells.map((c, i) => pad(c, widths[i])).join('  ')

  console.log(line(headers))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const r of table) console.log(line(r))

  console.log('')
  console.log(`rows:        ${rows.length}`)
  console.log(`would clear: ${wouldClear}`)
  const whyKeys = Object.keys(whyCounts).sort()
  if (whyKeys.length === 0) {
    console.log('kept:        (none)')
  } else {
    console.log('kept by why:')
    for (const k of whyKeys) console.log(`  ${pad(k, 16)} ${whyCounts[k]}`)
  }
}

main()
