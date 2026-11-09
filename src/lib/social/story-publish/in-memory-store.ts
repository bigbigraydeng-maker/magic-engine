/**
 * Story auto-publish — in-memory storage implementation (slice 2b).
 *
 * A faithful in-memory model of the SQL tables behind `StoryStore`, used by
 * tests and the dry-run rehearsal. It enforces the same rules the real
 * database enforces (single live grant per pack, item linkage validation,
 * idempotent opens) so that a rehearsal exercises the same code paths as
 * production. No timers, no process.env, no `any`.
 */
import { randomUUID } from 'node:crypto'
import type {
  InsertStoryAuthorizationResult,
  NewStoryAuthorization,
  RegisteredStoryAccounts,
  StoryAttemptView,
  StoryOpenRecord,
  StoryPauseMark,
  StoryStore,
  StoredStoryItem,
} from './store'
import type { StoryAuthorization, StoryChannel } from './types'

interface RevocationRecord {
  byEmail: string
  reason: string
  at: string
}

interface PauseRecord {
  packId: string
  clientId: string
  mark: StoryPauseMark
  lifted: boolean
}

export class InMemoryStoryStore implements StoryStore {
  private readonly items = new Map<string, StoredStoryItem>()
  private readonly authorizations = new Map<string, StoryAuthorization>()
  private readonly requestIds = new Map<string, string>()
  private readonly revocations = new Map<string, RevocationRecord>()
  private readonly opens: StoryOpenRecord[] = []
  private readonly attempts = new Map<string, StoryAttemptView[]>()
  private readonly accounts = new Map<string, RegisteredStoryAccounts>()
  private readonly replyDuty = new Set<string>()
  private readonly assetUsage = new Map<string, 'UNUSED' | 'USED'>()
  private readonly pauses: PauseRecord[] = []

  // ---- seed helpers -------------------------------------------------------

  seedItems(items: StoredStoryItem[]): void {
    for (const item of items) {
      this.items.set(itemKey(item.item_id, item.channel), cloneItem(item))
    }
  }

  seedAccounts(clientId: string, accounts: RegisteredStoryAccounts): void {
    this.accounts.set(clientId, { ...accounts })
  }

  seedReplyDuty(clientId: string, dutyDate: string): void {
    this.replyDuty.add(dutyKey(clientId, dutyDate))
  }

  seedAssetUsage(mediaSha256: string, usage: 'UNUSED' | 'USED'): void {
    this.assetUsage.set(mediaSha256, usage)
  }

  seedAttempts(attempts: StoryAttemptView[], packId: string): void {
    this.attempts.set(
      packId,
      attempts.map((a) => ({ ...a })),
    )
  }

  seedPause(
    packId: string,
    clientId: string,
    mark: StoryPauseMark,
    lifted = false,
  ): void {
    this.pauses.push({
      packId,
      clientId,
      mark: { channel: mark.channel, item_id: mark.item_id },
      lifted,
    })
  }

  // ---- read helpers -------------------------------------------------------

  allAuthorizations(): StoryAuthorization[] {
    return [...this.authorizations.values()].map(cloneAuthorization)
  }

  allItems(): StoredStoryItem[] {
    return [...this.items.values()].map(cloneItem)
  }

  revocationOf(authId: string): RevocationRecord | null {
    const record = this.revocations.get(authId)
    return record ? { ...record } : null
  }

  // ---- StoryStore ---------------------------------------------------------

  async getPackItems(packId: string, clientId: string): Promise<StoredStoryItem[]> {
    const matching = [...this.items.values()].filter(
      (item) => item.pack_id === packId && item.client_id === clientId,
    )
    matching.sort((a, b) => {
      if (a.slot_at !== b.slot_at) return a.slot_at < b.slot_at ? -1 : 1
      if (a.item_id !== b.item_id) return a.item_id < b.item_id ? -1 : 1
      if (a.channel !== b.channel) return a.channel < b.channel ? -1 : 1
      return 0
    })
    return matching.map(cloneItem)
  }

  async getLiveAuthorization(
    packId: string,
    clientId: string,
  ): Promise<StoryAuthorization | null> {
    for (const auth of this.authorizations.values()) {
      if (
        auth.pack_id === packId &&
        auth.client_id === clientId &&
        auth.revoked_at === null
      ) {
        return cloneAuthorization(auth)
      }
    }
    return null
  }

  async insertAuthorization(
    row: NewStoryAuthorization,
  ): Promise<InsertStoryAuthorizationResult> {
    for (const auth of this.authorizations.values()) {
      if (
        auth.pack_id === row.pack_id &&
        auth.client_id === row.client_id &&
        auth.revoked_at === null
      ) {
        return { ok: false, error: 'ALREADY_AUTHORIZED' }
      }
    }
    const id = randomUUID()
    const authorization: StoryAuthorization = {
      id,
      pack_id: row.pack_id,
      client_id: row.client_id,
      authorized_by_email: row.authorized_by_email,
      authorized_by_user_id: row.authorized_by_user_id,
      authorized_at: row.authorized_at,
      activated_at: null,
      expires_at: row.expires_at,
      revoked_at: null,
      manifest_hash: row.manifest_hash,
      approved_item_fingerprints: { ...row.approved_item_fingerprints },
    }
    this.authorizations.set(id, authorization)
    this.requestIds.set(id, row.request_id)
    return { ok: true, authorization: cloneAuthorization(authorization) }
  }

  async activateAuthorization(
    authId: string,
    clientId: string,
  ): Promise<StoryAuthorization | null> {
    const auth = this.authorizations.get(authId)
    if (!auth || auth.client_id !== clientId || auth.revoked_at !== null) {
      return null
    }
    if (auth.activated_at === null) {
      auth.activated_at = new Date().toISOString()
    }
    return cloneAuthorization(auth)
  }

  async revokeAuthorization(input: {
    authId: string
    packId: string
    clientId: string
    byEmail: string
    reason: string
    now: Date
  }): Promise<StoryAuthorization | null> {
    const auth = this.authorizations.get(input.authId)
    if (
      !auth ||
      auth.pack_id !== input.packId ||
      auth.client_id !== input.clientId ||
      auth.revoked_at !== null
    ) {
      return null
    }
    auth.revoked_at = input.now.toISOString()
    this.revocations.set(input.authId, {
      byEmail: input.byEmail,
      reason: input.reason,
      at: auth.revoked_at,
    })
    return cloneAuthorization(auth)
  }

  async linkItemsToAuthorization(input: {
    authId: string
    packId: string
    clientId: string
    items: Array<{ item_id: string; channel: StoryChannel }>
  }): Promise<void> {
    const targets: StoredStoryItem[] = []
    for (const ref of input.items) {
      const item = this.items.get(itemKey(ref.item_id, ref.channel))
      if (
        !item ||
        item.pack_id !== input.packId ||
        item.client_id !== input.clientId
      ) {
        throw new Error('unknown item')
      }
      targets.push(item)
    }
    for (const item of targets) {
      item.authorization_id = input.authId
    }
  }

  async recordOpen(record: StoryOpenRecord): Promise<void> {
    const item = this.items.get(itemKey(record.item_id, record.channel))
    if (!item) throw new Error('unknown item')
    const exists = this.opens.some(
      (open) =>
        open.item_id === record.item_id &&
        open.channel === record.channel &&
        open.opened_by_user_id === record.opened_by_user_id &&
        open.opened_fingerprint === record.opened_fingerprint &&
        open.opened_at.slice(0, 10) === record.opened_at.slice(0, 10),
    )
    // same person + item + version + UTC day = one record; a later day writes a new one (renewal)
    if (exists) return
    this.opens.push({ ...record })
  }

  async listOpens(packId: string): Promise<StoryOpenRecord[]> {
    const result: StoryOpenRecord[] = []
    for (const open of this.opens) {
      const item = this.items.get(itemKey(open.item_id, open.channel))
      if (item && item.pack_id === packId) {
        result.push({ ...open })
      }
    }
    return result
  }

  async listAttempts(packId: string): Promise<StoryAttemptView[]> {
    const stored = this.attempts.get(packId)
    return stored ? stored.map((a) => ({ ...a })) : []
  }

  async getActivePauses(
    packId: string,
    clientId: string,
  ): Promise<StoryPauseMark[]> {
    return this.pauses
      .filter(
        (pause) =>
          pause.packId === packId &&
          pause.clientId === clientId &&
          !pause.lifted,
      )
      .map((pause) => ({
        channel: pause.mark.channel,
        item_id: pause.mark.item_id,
      }))
  }

  async getRegisteredAccounts(
    clientId: string,
  ): Promise<RegisteredStoryAccounts | null> {
    const accounts = this.accounts.get(clientId)
    return accounts ? { ...accounts } : null
  }

  async hasReplyOwner(clientId: string, dutyDate: string): Promise<boolean> {
    return this.replyDuty.has(dutyKey(clientId, dutyDate))
  }

  async getAssetUsage(mediaSha256: string): Promise<'UNUSED' | 'USED' | 'UNKNOWN'> {
    return this.assetUsage.get(mediaSha256) ?? 'UNKNOWN'
  }
}

function itemKey(itemId: string, channel: StoryChannel): string {
  return `${itemId}:${channel}`
}

function dutyKey(clientId: string, dutyDate: string): string {
  return `${clientId}:${dutyDate}`
}

function cloneItem(item: StoredStoryItem): StoredStoryItem {
  return {
    ...item,
    source_record_ids: [...item.source_record_ids],
  }
}

function cloneAuthorization(auth: StoryAuthorization): StoryAuthorization {
  return {
    ...auth,
    approved_item_fingerprints: { ...auth.approved_item_fingerprints },
  }
}
