/**
 * P21.K.5 — Creative-pool intake: published factory reels → candidate entries.
 *
 * Today a human hand-types ad-creative candidates into
 * `ad_strategy_configs.creative_pool`. Every already-published factory reel
 * already carries a Meta video id in `content_work_orders.published_ref.video_id`,
 * so this module automates the REGISTRATION step only: a published reel becomes
 * a `{ kind: 'meta_video', ref: videoId, status: 'candidate' }` entry.
 *
 * Three things worth stating up front:
 *
 *  1. Approval is NOT here. Approval is human-only and goes through
 *     `/api/clients/[id]/ad-strategy-config/creative-pool/approve`. Intake only
 *     ever appends `candidate` entries; it never flips a status.
 *
 *  2. Appending a candidate is safe. Every consumer of the pool counts only
 *     `status === 'approved'`, so a stray candidate cannot cause spend. The
 *     worst case of a bad append is a row a human ignores.
 *
 *  3. A `fallback` config read must NEVER be written back. When the config read
 *     fails we hold a default (empty pool), not the truth. Writing that back
 *     would overwrite a real pool and silently destroy approvals — so on
 *     `source === 'fallback'` we block and write nothing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  loadAdStrategyConfigWithSource,
  type CreativePoolEntry,
  type LoadedAdStrategyConfig,
} from './config'

/**
 * How the current config is read. Injectable for one reason only: the real loader
 * reaches for the module-level `supabaseAdmin`, not the client passed in here, so a
 * test that does not inject it would hit the network and then pass for the wrong
 * reason — the run would block on a failed config read and never reach the planner.
 * (That is exactly what the first draft of the dry-run test did.)
 */
export type ConfigLoader = (clientId: string) => Promise<LoadedAdStrategyConfig>

/** Only reels published inside this window become candidates. Older creative is stale. */
export const INTAKE_LOOKBACK_DAYS = 60

/** One already-published reel, reduced to what intake needs. */
export interface PublishedCreative {
  /** content_work_orders.id */
  readonly workOrderId: string
  /** published_ref.video_id */
  readonly videoId: string
}

/** What one intake run did (or would do, in dry-run). */
export interface IntakeReceipt {
  readonly clientId: string
  readonly dryRun: boolean
  /** Entries that were appended (or would be). */
  readonly added: readonly CreativePoolEntry[]
  /** Published reels whose videoId was already in the pool, with any status. */
  readonly alreadyInPool: number
  /** Published reels considered in the window. */
  readonly considered: number
  /** Set when the run did nothing because a fact could not be read. */
  readonly blocked: string | null
}

/** Shape of a `content_work_orders` row as far as intake cares. */
interface WorkOrderRow {
  id: string
  published_ref: unknown
  created_at: string | null
}

/**
 * Pure judgement: given the published reels and the current pool, decide what
 * to append. Never modifies or drops an existing entry — only returns entries
 * to append, in the order of `published`.
 *
 * Matching is by `ref === videoId` regardless of `kind` or `status`: a video a human
 * has already approved must not be re-added as a fresh candidate, which would reset
 * it in the eyes of anyone reading the pool.
 */
export function planCreativePoolIntake(
  published: readonly PublishedCreative[],
  pool: readonly CreativePoolEntry[],
): { readonly toAdd: readonly CreativePoolEntry[]; readonly alreadyInPool: number } {
  const existingRefs = new Set(pool.map(entry => entry.ref))
  const seen = new Set<string>()
  const toAdd: CreativePoolEntry[] = []
  let alreadyInPool = 0

  for (const item of published) {
    // Deduplicate inside `published` too: two work orders, one video id, one entry.
    if (seen.has(item.videoId)) continue
    seen.add(item.videoId)

    if (existingRefs.has(item.videoId)) {
      alreadyInPool += 1
      continue
    }

    // Exactly a candidate — no approved_by, no approved_at. Approval is human-only.
    toAdd.push({ kind: 'meta_video', ref: item.videoId, status: 'candidate' })
  }

  return { toAdd, alreadyInPool }
}

/** Extract a usable video id from `published_ref`, or null when the shape is wrong. */
function readVideoId(publishedRef: unknown): string | null {
  if (typeof publishedRef !== 'object' || publishedRef === null) return null
  if (!('video_id' in publishedRef)) return null
  const videoId = publishedRef.video_id
  if (typeof videoId === 'string') return videoId.length > 0 ? videoId : null
  if (typeof videoId === 'number' && Number.isFinite(videoId)) return String(videoId)
  return null
}

/** Map raw rows to `PublishedCreative`, silently skipping rows without a usable id. */
function toPublishedCreative(rows: readonly WorkOrderRow[]): PublishedCreative[] {
  const out: PublishedCreative[] = []
  for (const row of rows) {
    const videoId = readVideoId(row.published_ref)
    if (videoId === null) continue
    out.push({ workOrderId: row.id, videoId })
  }
  return out
}

/** Window start as ISO string: `now` minus `INTAKE_LOOKBACK_DAYS` days. */
function windowStartIso(now: Date): string {
  const start = new Date(now.getTime() - INTAKE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  return start.toISOString()
}

/** Build a receipt for a run that did nothing because a fact could not be read. */
function blockedReceipt(
  clientId: string,
  dryRun: boolean,
  blocked: string,
): IntakeReceipt {
  return { clientId, dryRun, added: [], alreadyInPool: 0, considered: 0, blocked }
}

/**
 * Run intake for one client. Never throws; failures surface as `blocked`.
 *
 * Order matters: read facts → load config (block on fallback) → plan → write.
 * We never write before we know the current pool is the truth.
 */
export async function runCreativePoolIntake(
  sb: SupabaseClient,
  clientId: string,
  opts: {
    readonly dryRun: boolean
    readonly now?: Date
    /** Defaults to the real loader; see `ConfigLoader` for why it is injectable. */
    readonly loadConfig?: ConfigLoader
  },
): Promise<IntakeReceipt> {
  const windowStart = windowStartIso(opts.now ?? new Date())

  const { data, error } = await sb
    .from('content_work_orders')
    .select('id, published_ref, created_at')
    .eq('client_id', clientId)
    .eq('status', 'published')
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return blockedReceipt(clientId, opts.dryRun, `facts:work_orders_read_failed:${error.message}`)
  }

  const published = toPublishedCreative((data ?? []) as WorkOrderRow[])

  // 🔴 A fallback read means the pool we hold is a guess. Writing it back would
  // overwrite a real pool with an empty default and silently destroy approvals.
  const loaded = await (opts.loadConfig ?? loadAdStrategyConfigWithSource)(clientId)
  if (loaded.source === 'fallback') {
    return blockedReceipt(clientId, opts.dryRun, 'facts:ad_strategy_config_read_failed')
  }

  /**
   * 🔴 No config row yet (`source === 'default'`) → do nothing, do NOT create one.
   *
   * The upsert below writes only `client_id` / `creative_pool` / `updated_at`, so on a
   * client with no row it would INSERT one and let the rest fall to DB defaults —
   * and `ad_strategy_configs.enabled` defaults to `true`. That would silently enrol
   * a client into the ads engine (patrol, digests) as a side effect of registering
   * creative. Enrolling a client is a decision, not a by-product; it belongs to the
   * settings panel. A client with no ads config also has nothing to use creative for.
   *
   * The budget / autonomy columns are not the risk here (they default to the locked
   * `observe` + autopilot-off side); `enabled` is.
   */
  if (loaded.source !== 'row') {
    return blockedReceipt(clientId, opts.dryRun, 'facts:no_ad_strategy_config_row')
  }

  const { toAdd, alreadyInPool } = planCreativePoolIntake(published, loaded.config.creative_pool)
  const considered = published.length

  if (toAdd.length === 0 || opts.dryRun) {
    return { clientId, dryRun: opts.dryRun, added: toAdd, alreadyInPool, considered, blocked: null }
  }

  const nextPool: CreativePoolEntry[] = [...loaded.config.creative_pool, ...toAdd]
  const { error: writeError } = await sb
    .from('ad_strategy_configs')
    .upsert(
      { client_id: clientId, creative_pool: nextPool, updated_at: new Date().toISOString() },
      { onConflict: 'client_id' },
    )

  if (writeError) {
    return blockedReceipt(clientId, opts.dryRun, `facts:pool_write_failed:${writeError.message}`)
  }

  return { clientId, dryRun: opts.dryRun, added: toAdd, alreadyInPool, considered, blocked: null }
}
