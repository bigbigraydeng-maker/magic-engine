import type { KernelDeps } from '@/lib/kernel/deps'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import {
  contentFingerprint,
  decideConfirmationCard,
  issueConfirmationCard,
  normalizeFacts,
  type CardClicker,
  type CardResolution,
  type ConfirmationCardView,
} from '@/lib/confirmation-card'
import { assertMayIssue } from '@/lib/confirmation-card/actor'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { CardFacts } from '@/lib/confirmation-card/facts'
import { acceptUploadedVideoId, ASSET_UPLOAD_REFUSED, type AdmitOutcome } from './admit-finished-asset'
import { VIDEO_UPLOAD_WHAT } from './paused-draft-copy'

type Sb = KernelDeps['supabase']
export const VIDEO_UPLOAD_HOLD = 'ads.video_upload_hold'
type HoldStatus = 'holding' | 'writing' | 'executed' | 'failed' | 'declined'

export interface VideoUploadHold {
  status: HoldStatus
  cardRunId: string
  fingerprint: string
  workOrderId: string
  accountId: string
  fileUrl: string
  videoId: string | null
  wrote: boolean
  resultLine?: string
}

interface HoldRow { readonly id: string; readonly payload: VideoUploadHold }

export interface VideoUploadExec {
  currentFileUrl(workOrderId: string): Promise<string | null>
  accountRegistered(accountId: string): Promise<boolean>
  token(): Promise<string | null>
  upload(accountId: string, fileUrl: string, token: string): Promise<{ ok: true; videoId: string } | { ok: false; error: string }>
  readBack(accountId: string, videoId: string, token: string): Promise<{ ok: true; videoId: string } | { ok: false; error: string }>
  remember(workOrderId: string, videoId: string, accountId: string): Promise<{ ok: true } | { ok: false; error: string }>
}

export interface VideoUploadResult {
  readonly statusCode: number
  readonly reason: string
  readonly wrote: boolean
  readonly card: ConfirmationCardView | null
  readonly workOrderId: string | null
  readonly videoId: string | null
}

export function videoUploadFacts(workOrderId: string, accountId: string, fileUrl: string): CardFacts {
  const stamp = canonicalHashOfInput({ workOrderId, accountId, fileUrl }).slice(0, 8)
  return {
    subjectKey: `video-upload:${canonicalHashOfInput({ workOrderId }).slice(0, 12)}`,
    what: VIDEO_UPLOAD_WHAT,
    account: '已登记的广告账户',
    amount: '不花钱',
    date: '确认之后才传',
    scope: `只上传这一条视频（记号 ${stamp}），不建广告、不打开、不改预算`,
    hardChecks: [{ label: '只传文件', state: 'green', reason: '不建广告，不打开，不改预算' }],
  }
}

export async function requestVideoUploadCard(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  workOrderId: string
  accountId: string
  fileUrl: string
  now?: Date
}): Promise<ConfirmationCardView> {
  assertMayIssue(args.clicker, args.clientId)
  if (!args.fileUrl.startsWith('https://')) {
    throw new ConfirmationCardError('invalid', '成片地址不对，没有出上传确认卡。')
  }
  const facts = videoUploadFacts(args.workOrderId, args.accountId, args.fileUrl)
  const fingerprint = contentFingerprint(normalizeFacts(facts))
  await retireOther(args.kernel.supabase, args.clientId, args.workOrderId, fingerprint)
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId, clicker: args.clicker, facts, now: args.now,
  })
  const existing = await rowsFor(args.kernel.supabase, args.clientId, 'payload->>cardRunId', card.runId)
  if (existing.length > 0) return card
  await insertHold(args.kernel.supabase, args.clientId, {
    status: 'holding', cardRunId: card.runId, fingerprint: card.fingerprint,
    workOrderId: args.workOrderId, accountId: args.accountId, fileUrl: args.fileUrl,
    videoId: null, wrote: false,
  })
  return card
}

export async function confirmVideoUploadCard(args: {
  kernel: KernelDeps
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  deps: VideoUploadExec
  now?: Date
}): Promise<VideoUploadResult> {
  const row = await holdForRun(args.kernel.supabase, args.clientId, args.runId)
  if (!row) return stopped(404, '找不到这张确认卡，没有上传。')
  if (row.payload.fingerprint !== args.fingerprint) return stopped(409, '你看到的内容已经不是这一张卡了。请刷新后再点。')
  if (row.payload.status === 'writing') return stopped(409, '上次上传还没记完，没有再传一次。')
  if (row.payload.status !== 'holding') return already(row)
  if (args.resolution === 'decline') return decline(args, row)
  const block = await guard(args.deps, row.payload)
  if (block) return stopped(409, block)
  const card = await decideConfirmationCard(args.kernel, decisionArgs(args))
  if (card.status !== 'confirmed') return closeUnconfirmed(args, row, card)
  if (!await claim(args.kernel.supabase, args.clientId, row)) return stopped(409, '上次上传还没记完，没有再传一次。')
  return writeOnce(args, row, card)
}

export async function uploadOrAsk(input: {
  admit: () => Promise<AdmitOutcome>
  ask: () => Promise<{ ok: true } | { ok: false; error: string }>
}): Promise<
  | { ok: true; videoId: string | null; accountId: string | null; awaitingCard?: boolean }
  | { ok: false; error: string }
> {
  const uploaded = await input.admit()
  if (!uploaded.ok && uploaded.error === ASSET_UPLOAD_REFUSED) {
    const asked = await input.ask()
    if (!asked.ok) return asked
    return { ok: true, videoId: null, accountId: null, awaitingCard: true }
  }
  if (!uploaded.ok) return { ok: false, error: uploaded.error }
  if (uploaded.action !== 'uploaded') return { ok: true, videoId: null, accountId: null }
  return { ok: true, videoId: uploaded.videoId, accountId: uploaded.accountId }
}

async function guard(deps: VideoUploadExec, hold: VideoUploadHold): Promise<string | null> {
  const live = await deps.currentFileUrl(hold.workOrderId)
  if (live !== hold.fileUrl) return '成片已经换过了，这张卡不能用来上传。'
  if (!await deps.accountRegistered(hold.accountId)) return '广告账户已经不是这个客户登记的账户，没有上传。'
  return null
}

async function writeOnce(
  args: Parameters<typeof confirmVideoUploadCard>[0],
  row: HoldRow,
  card: ConfirmationCardView,
): Promise<VideoUploadResult> {
  const outcome = await perform(row.payload, args.deps)
  const next: VideoUploadHold = {
    ...row.payload,
    status: outcome.ok ? 'executed' : 'failed',
    wrote: outcome.wrote,
    videoId: outcome.videoId,
    resultLine: outcome.reason,
  }
  await save(args.kernel.supabase, args.clientId, row, next)
  return {
    statusCode: outcome.ok ? 200 : 502,
    reason: outcome.reason,
    wrote: outcome.wrote,
    card,
    workOrderId: row.payload.workOrderId,
    videoId: outcome.videoId,
  }
}

async function perform(hold: VideoUploadHold, deps: VideoUploadExec) {
  const token = await deps.token()
  if (!token) return fail('没有这个客户的广告授权，没有上传。', false, null)
  const uploaded = await deps.upload(hold.accountId, hold.fileUrl, token).catch(() => ({ ok: false as const, error: '上传失败。' }))
  if (!uploaded.ok) return fail('视频没有传上去。', false, null)
  const accepted = acceptUploadedVideoId({
    uploadedToAccountId: hold.accountId,
    registeredAccountIds: [hold.accountId],
    returnedVideoId: uploaded.videoId,
  })
  if (!accepted.ok) return fail(accepted.error, true, null)
  const seen = await deps.readBack(hold.accountId, accepted.videoId, token).catch(() => ({ ok: false as const, error: '回读失败。' }))
  if (!seen.ok || seen.videoId !== accepted.videoId) return fail('回读没有在广告账户里看到这条视频，没有记下。', true, null)
  const remembered = await deps.remember(hold.workOrderId, accepted.videoId, hold.accountId)
  if (!remembered.ok) return fail('视频传上去了，但工单没有记下编号。', true, accepted.videoId)
  return { ok: true, wrote: true, reason: '已传到广告账户，回读到同一条视频。', videoId: accepted.videoId }
}

function fail(reason: string, wrote: boolean, videoId: string | null) {
  return { ok: false, wrote, reason, videoId }
}
async function decline(
  args: Parameters<typeof confirmVideoUploadCard>[0],
  row: HoldRow,
): Promise<VideoUploadResult> {
  const card = await decideConfirmationCard(args.kernel, decisionArgs(args))
  await save(args.kernel.supabase, args.clientId, row, { ...row.payload, status: 'declined', wrote: false, resultLine: '没有上传。' })
  return { statusCode: 200, reason: '没有上传。', wrote: false, card, workOrderId: row.payload.workOrderId, videoId: null }
}
async function closeUnconfirmed(
  args: Parameters<typeof confirmVideoUploadCard>[0],
  row: HoldRow,
  card: ConfirmationCardView,
): Promise<VideoUploadResult> {
  const reason = card.statusLine || '这张卡没有确认成功，没有上传。'
  await save(args.kernel.supabase, args.clientId, row, { ...row.payload, status: 'failed', wrote: false, resultLine: reason })
  return { statusCode: 200, reason, wrote: false, card, workOrderId: row.payload.workOrderId, videoId: null }
}
function decisionArgs(args: Parameters<typeof confirmVideoUploadCard>[0]) {
  return {
    clientId: args.clientId,
    runId: args.runId,
    clicker: args.clicker,
    resolution: args.resolution,
    expectedDecisionId: args.expectedDecisionId,
    fingerprint: args.fingerprint,
    now: args.now,
  }
}

async function retireOther(sb: Sb, clientId: string, workOrderId: string, fingerprint: string): Promise<void> {
  const rows = await rowsFor(sb, clientId, 'payload->>workOrderId', workOrderId)
  if (rows.some((row) => row.payload.wrote)) {
    throw new ConfirmationCardError('invalid', '这条成片已经传过一次，没有再出一张卡。')
  }
  if (rows.some((row) => row.payload.status === 'writing')) {
    throw new ConfirmationCardError('invalid', '上次上传还没记完，没有再出一张卡。')
  }
  for (const row of rows) {
    if (row.payload.status !== 'holding' || row.payload.fingerprint === fingerprint) continue
    await save(sb, clientId, row, { ...row.payload, status: 'failed', wrote: false, resultLine: '成片变了，这张旧卡不能用来上传。' })
  }
}

function stopped(statusCode: number, reason: string): VideoUploadResult {
  return { statusCode, reason, wrote: false, card: null, workOrderId: null, videoId: null }
}

function already(row: HoldRow): VideoUploadResult {
  return {
    statusCode: 409,
    reason: row.payload.resultLine ?? '这张卡已经有结果了，没有再上传。',
    wrote: row.payload.wrote,
    card: null,
    workOrderId: row.payload.workOrderId,
    videoId: row.payload.videoId,
  }
}

async function holdForRun(sb: Sb, clientId: string, runId: string): Promise<HoldRow | null> {
  const rows = await rowsFor(sb, clientId, 'payload->>cardRunId', runId)
  return rows.length === 1 ? rows[0] ?? null : null
}

async function insertHold(sb: Sb, clientId: string, payload: VideoUploadHold): Promise<void> {
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: 'ads',
    action_type: VIDEO_UPLOAD_HOLD,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
    expected_metric: null,
  })
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有上传。')
}

async function claim(sb: Sb, clientId: string, row: HoldRow): Promise<boolean> {
  const next = { ...row.payload, status: 'writing' as const, wrote: false }
  const { data, error } = await sb.from('flywheel_actions')
    .update({ payload: next })
    .eq('id', row.id)
    .eq('client_id', clientId)
    .eq('payload->>status', 'holding')
    .select('id')
    .maybeSingle()
  return !error && Boolean((data as { id?: string } | null)?.id)
}

async function save(sb: Sb, clientId: string, row: HoldRow, payload: VideoUploadHold): Promise<void> {
  const patch: Record<string, unknown> = { payload }
  if (payload.status === 'executed') patch.executed_at = new Date().toISOString()
  const { error } = await sb.from('flywheel_actions').update(patch).eq('id', row.id).eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再上传一次。')
}

async function rowsFor(sb: Sb, clientId: string, column: string, value: string): Promise<HoldRow[]> {
  const { data, error } = await sb.from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', VIDEO_UPLOAD_HOLD)
    .eq(column, value)
  if (error) throw new ConfirmationCardError('invalid', '上传确认卡的台账读不出来，没有上传。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as VideoUploadHold
  if (!payload.cardRunId || !payload.workOrderId || !payload.accountId || !payload.fileUrl) return []
  return [{ id: row.id, payload }]
}
