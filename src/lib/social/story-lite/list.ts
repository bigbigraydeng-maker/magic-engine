/**
 * Story "lite" — the pack list for the preview page, plus the one-line "is this really publishing?" answer.
 * Read-only. Global administrators only (same gate as preview / authorise / revoke).
 */
import { packState, requireGlobalAdmin, type LitePackState, type LiteResult, type LiteServicePorts } from './service'
import { isLiveFor, type LiteActor, type LiteSwitches } from './types'

const LIST_LIMIT = 10

export interface LitePackSummary {
  pack_id: string
  title: string
  state: LitePackState
  created_at: string
  authorized_at: string | null
  expires_at: string | null
  item_count: number
}

export interface LitePackList {
  /** True only when this client is really allowed to publish right now. */
  live: boolean
  packs: LitePackSummary[]
}

export async function listLitePacks(input: {
  ports: LiteServicePorts
  clientId: string
  actor: LiteActor
  switches: LiteSwitches
  now: Date
}): Promise<LiteResult<LitePackList>> {
  const { ports, clientId, actor, switches, now } = input
  const admin = requireGlobalAdmin(ports, actor)
  if (!admin.ok) return admin
  const rows = await ports.store.listPacksForClient(clientId, LIST_LIMIT)
  return {
    ok: true,
    value: {
      live: isLiveFor(switches, clientId),
      packs: rows.map(({ pack, item_count }) => ({
        pack_id: pack.id,
        title: pack.title,
        state: packState(pack, now),
        created_at: pack.created_at,
        authorized_at: pack.authorized_at,
        expires_at: pack.expires_at,
        item_count,
      })),
    },
  }
}
