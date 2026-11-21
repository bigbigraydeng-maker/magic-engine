/**
 * Leads → client Google Sheets without Inngest (2026-11-16, Inngest monthly quota exhausted until about 12-01).
 *
 * Same work as the Inngest fan-out + per-client function (lib/inngest/functions/lead-sheet-sync.ts), run in-process
 * by the Render dispatcher at minute 50 (Inngest runs at minute 20, so the two never overlap in practice). Writes one
 * run-log row per client under the same job name, so the to-do mail's "lead sheet failed" items keep working.
 * Clients run one after another: the sheet de-duplication is read-then-write and must not race itself.
 *
 * Switch: env INNGEST_DIRECT_FALLBACK = 'off' turns this off.
 */

import type { LeadSheetClientReceipt } from './types'

export interface DirectLeadSheetDeps {
  loadClientIds(): Promise<string[]>
  loadClientName(clientId: string): Promise<string | null>
  sync(client: { id: string; name: string | null }): Promise<LeadSheetClientReceipt>
  /** One run-log row per client, same shape as the Inngest per-client run. */
  logClient(receipt: LeadSheetClientReceipt, startedAt: number): Promise<void>
}

export interface DirectLeadSheetReceipt {
  status: 'done' | 'roster_failed' | 'busy'
  clients: number
  appended: number
  failedClients: number
  error: string | null
}

let running = false

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}

export async function runDirectLeadSheetSync(deps: DirectLeadSheetDeps): Promise<DirectLeadSheetReceipt> {
  if (running) return { status: 'busy', clients: 0, appended: 0, failedClients: 0, error: null }
  running = true
  try {
    let ids: string[]
    try {
      ids = await deps.loadClientIds()
    } catch (err) {
      return { status: 'roster_failed', clients: 0, appended: 0, failedClients: 0, error: errText(err) }
    }
    let appended = 0
    let failedClients = 0
    let firstError: string | null = null
    for (const id of ids) {
      const startedAt = Date.now()
      let receipt: LeadSheetClientReceipt
      try {
        receipt = await deps.sync({ id, name: await deps.loadClientName(id) })
      } catch (err) {
        receipt = { clientId: id, clientName: null, routes: [], unrouted: 0, error: errText(err), warning: null }
      }
      appended += receipt.routes.reduce((n, r) => n + r.appended, 0)
      const routeError = receipt.routes.find((r) => r.error)?.error ?? null
      if (receipt.error || routeError) {
        failedClients++
        firstError ??= receipt.error ?? routeError
      }
      await deps.logClient(receipt, startedAt)
    }
    return { status: 'done', clients: ids.length, appended, failedClients, error: firstError }
  } finally {
    running = false
  }
}
