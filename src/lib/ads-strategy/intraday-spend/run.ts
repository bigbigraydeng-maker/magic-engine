import { leadGraphBackoffMs } from '@/lib/meta/lead-graph-rate-limit'
import {
  SAMPLE_BATCH_PAUSE_MS,
  SAMPLE_BATCH_SIZE,
  SAMPLE_GAP_MS,
} from './constants'
import {
  accountDayKey,
  bucketMinute,
  draftsForAccount,
  localMinuteOfDay,
  retentionCutoff,
  type SpendDraft,
} from './sample'
import { pacingFromSamples, sinceDay, type PacingPayload } from './view'
export interface AccountRead {
  complete: boolean
  rateLimited: boolean
  adsets: { id: string; campaignId: string | null; status: string | null }[]
  insights: { adsetId: string; spend?: string; impressions?: string }[]
}
export interface SampleDeps {
  listClients(): Promise<{ id: string }[]>
  listAccounts(clientId: string): Promise<{ adAccountId: string; hidden: boolean }[]>
  sharedBareIds(clientId: string, ids: string[]): Promise<Set<string>>
  accountContext(adAccountId: string): Promise<{ timezone: string | null; currency: string | null }>
  token(clientId: string): Promise<string | null>
  readAccount(adAccountId: string, token: string, day: string): Promise<AccountRead>
  upsert(rows: SpendDraft[]): Promise<void>
  purge(beforeIso: string): Promise<number>
  loadSamples(clientId: string, since: string): Promise<SpendDraft[]>
  capMinor(clientId: string): Promise<number | null>
}
export interface SampleReceipt {
  dryRun: boolean
  clients: number
  accountsSampled: number
  rows: number
  purged: number
  skippedTimezone: number
  skippedHidden: number
  skippedShared: number
  skippedNoToken: number
  noLive: number
  failed: number
  rateLimited: boolean
  overCapClients: string[]
}
export async function runIntradaySample(
  deps: SampleDeps,
  opts: { now: Date; sleep(ms: number): Promise<void>; dryRun?: boolean },
): Promise<SampleReceipt> {
  const receipt = emptyReceipt(opts.dryRun === true)
  const clients = await deps.listClients()
  receipt.clients = clients.length
  const drafts: SpendDraft[] = []
  let reads = 0
  for (const client of clients) {
    const token = await deps.token(client.id)
    const accounts = await deps.listAccounts(client.id)
    const shared = await deps.sharedBareIds(client.id, accounts.map((a) => a.adAccountId))
    for (const account of accounts) {
      const outcome = await sampleAccount(deps, opts, account, client.id, token, shared, reads)
      reads = outcome.reads
      if (outcome.skip) receipt[outcome.skip] += 1
      if (outcome.failed) receipt.failed += 1
      if (outcome.noLive) receipt.noLive += 1
      if (outcome.rows) {
        drafts.push(...outcome.rows)
        receipt.accountsSampled += 1
      }
      if (outcome.stop) {
        receipt.rateLimited = true
        break
      }
    }
    if (receipt.rateLimited) break
  }
  if (drafts.length > 0) await deps.upsert(drafts)
  receipt.rows = drafts.length
  receipt.purged = await deps.purge(retentionCutoff(opts.now))
  receipt.overCapClients = await overCapClients(deps, clients.map((c) => c.id), opts.now)
  return receipt
}
type SkipKey = 'skippedTimezone' | 'skippedHidden' | 'skippedShared' | 'skippedNoToken'

async function sampleAccount(
  deps: SampleDeps,
  opts: { now: Date; sleep(ms: number): Promise<void> },
  account: { adAccountId: string; hidden: boolean },
  clientId: string,
  token: string | null,
  shared: Set<string>,
  reads: number,
): Promise<{ reads: number; skip?: SkipKey; failed?: boolean; noLive?: boolean; rows?: SpendDraft[]; stop?: boolean }> {
  if (account.hidden) return { reads, skip: 'skippedHidden' }
  if (shared.has(bare(account.adAccountId))) return { reads, skip: 'skippedShared' }
  const ctx = await deps.accountContext(account.adAccountId)
  const day = ctx.timezone ? accountDayKey(ctx.timezone, opts.now) : null
  const minute = ctx.timezone ? localMinuteOfDay(ctx.timezone, opts.now) : null
  if (!ctx.timezone || !day || minute === null || bucketMinute(minute) === null) {
    return { reads, skip: 'skippedTimezone' }
  }
  if (!token) return { reads, skip: 'skippedNoToken' }
  await pauseBefore(opts.sleep, reads)
  const read = await readWithBackoff(deps, account.adAccountId, token, day, opts.sleep)
  const nextReads = reads + 1
  if (read.rateLimited) return { reads: nextReads, failed: true, stop: true }
  if (!read.complete) return { reads: nextReads, failed: true }
  const rows = draftsForAccount({
    clientId,
    adAccountId: account.adAccountId,
    accountDay: day,
    sampledAt: opts.now.toISOString(),
    localMinute: minute,
    timezone: ctx.timezone,
    currency: ctx.currency,
    adsets: read.adsets,
    insights: read.insights,
    insightsComplete: true,
  })
  if (rows === null) return { reads: nextReads, failed: true }
  if (rows.length === 0) return { reads: nextReads, noLive: true }
  return { reads: nextReads, rows }
}
async function pauseBefore(sleep: (ms: number) => Promise<void>, reads: number): Promise<void> {
  if (reads <= 0) return
  if (reads % SAMPLE_BATCH_SIZE === 0) await sleep(SAMPLE_BATCH_PAUSE_MS)
  else await sleep(SAMPLE_GAP_MS)
}
async function readWithBackoff(
  deps: SampleDeps,
  adAccountId: string,
  token: string,
  day: string,
  sleep: (ms: number) => Promise<void>,
): Promise<AccountRead> {
  const first = await deps.readAccount(adAccountId, token, day)
  if (!first.rateLimited) return first
  await sleep(leadGraphBackoffMs(1, {}))
  return deps.readAccount(adAccountId, token, day)
}
function bare(id: string): string {
  return id.replace(/^act_/i, '')
}
function emptyReceipt(dryRun: boolean): SampleReceipt {
  return {
    dryRun,
    clients: 0,
    accountsSampled: 0,
    rows: 0,
    purged: 0,
    skippedTimezone: 0,
    skippedHidden: 0,
    skippedShared: 0,
    skippedNoToken: 0,
    noLive: 0,
    failed: 0,
    rateLimited: false,
    overCapClients: [],
  }
}

async function overCapClients(deps: SampleDeps, clientIds: string[], now: Date): Promise<string[]> {
  const hits: string[] = []
  for (const clientId of clientIds) {
    const pacing = await pacingFor(deps, clientId, now)
    if (pacing?.clientOverCap) hits.push(clientId)
  }
  return hits
}

export async function pacingFor(
  deps: Pick<SampleDeps, 'loadSamples' | 'capMinor'>,
  clientId: string,
  now: Date,
): Promise<PacingPayload | null> {
  const rows = await deps.loadSamples(clientId, sinceDay(now))
  const cap = await deps.capMinor(clientId)
  return pacingFromSamples(rows, cap, now)
}
