/**
 * Weekly pack orchestration. Confirm fans out to the existing Story and Reel functions.
 * One line failing does not undo the lines that already succeeded.
 */

import { assertMayClick, type CardClicker } from '@/lib/confirmation-card/actor'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { CardFacts } from '@/lib/confirmation-card/facts'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'

import type { WeeklyPackCadence } from './cadence'
import { buildWeekPackFacts, scopeHasDigest, weekPackSubject } from './facts'
import { postLine, runReelLines, runStoryLine, type ReelPromoteResult, type StoryAuthResult } from './lines'
import type { WeekPackLine, WeekPackManifest, WeekPackReceipt } from './types'

export interface RevokeStoryResult {
  ok: boolean
  code: 'revoked' | 'nothing' | 'forbidden' | 'failed'
  sent: number
  inFlight: number
  summaryAvailable: boolean
}

export interface WeekPackPorts {
  loadManifest(clientId: string): Promise<WeekPackManifest>
  accountLabel(clientId: string): Promise<string>
  cadence(): WeeklyPackCadence
  reelGoPublic: boolean
  issueCard(facts: CardFacts): Promise<ConfirmationCardView>
  decideCard(input: {
    runId: string
    resolution: 'confirm' | 'decline'
    expectedDecisionId: string
    fingerprint: string
  }): Promise<ConfirmationCardView>
  authorizeStory(packId: string, contentHash: string): Promise<StoryAuthResult>
  revokeStory(packId: string, reason: string): Promise<RevokeStoryResult>
  promoteReel(workOrderId: string, previewToken: string): Promise<ReelPromoteResult>
}

export interface FlowResult {
  httpStatus: number
  message: string | null
  manifest: WeekPackManifest | null
  card: ConfirmationCardView | null
  receipt: WeekPackReceipt | null
}

export async function openWeekPack(args: {
  enabled: boolean
  clientId: string
  ports: WeekPackPorts
}): Promise<FlowResult> {
  const manifest = await args.ports.loadManifest(args.clientId)
  if (!args.enabled) return { httpStatus: 200, message: null, manifest, card: null, receipt: null }
  const built = await factsFor(args.clientId, manifest, args.ports)
  try {
    const card = await args.ports.issueCard(built.facts)
    return { httpStatus: 200, message: null, manifest, card, receipt: null }
  } catch (error) {
    if (error instanceof ConfirmationCardError) {
      return { httpStatus: 200, message: error.humanReason, manifest, card: null, receipt: null }
    }
    throw error
  }
}

export async function confirmWeekPack(args: {
  enabled: boolean
  clientId: string
  clicker: CardClicker
  runId: string
  expectedDecisionId: string
  fingerprint: string
  tokens: ReadonlyMap<string, string>
  ports: WeekPackPorts
}): Promise<FlowResult> {
  const gate = gateClick(args.clicker, args.clientId, args.enabled)
  if (gate) return gate
  const manifest = await args.ports.loadManifest(args.clientId)
  const built = await factsFor(args.clientId, manifest, args.ports)
  if (!sameList(built, args.fingerprint)) return changed(args.clientId, manifest)
  let card: ConfirmationCardView
  try {
    card = await args.ports.decideCard({
      runId: args.runId,
      resolution: 'confirm',
      expectedDecisionId: args.expectedDecisionId,
      fingerprint: args.fingerprint,
    })
  } catch (error) {
    return refused(error)
  }
  if (card.status !== 'confirmed') return stopped(args.clientId, manifest, card, built.facts.subjectKey)
  const lines = await applyConfirmed(manifest, args.ports, args.tokens)
  return done(args.clientId, manifest, card, built.facts.subjectKey, lines)
}

export async function declineWeekPack(args: {
  enabled: boolean
  clientId: string
  clicker: CardClicker
  runId: string
  expectedDecisionId: string
  fingerprint: string
  ports: WeekPackPorts
}): Promise<FlowResult> {
  const gate = gateClick(args.clicker, args.clientId, args.enabled)
  if (gate) return gate
  const manifest = await args.ports.loadManifest(args.clientId)
  const built = await factsFor(args.clientId, manifest, args.ports)
  if (!sameList(built, args.fingerprint)) return changed(args.clientId, manifest)
  try {
    const card = await args.ports.decideCard({
      runId: args.runId,
      resolution: 'decline',
      expectedDecisionId: args.expectedDecisionId,
      fingerprint: args.fingerprint,
    })
    const line: WeekPackLine = {
      kind: 'story', stable_id: null, code: 'declined_no_publish', ok: true,
      text: '没有同意。没有授权，也没有公开。',
    }
    return done(args.clientId, manifest, card, built.facts.subjectKey, [line])
  } catch (error) {
    return refused(error)
  }
}

export async function revokeWeekPack(args: {
  enabled: boolean
  clientId: string
  clicker: CardClicker
  ports: WeekPackPorts
}): Promise<FlowResult> {
  const gate = gateClick(args.clicker, args.clientId, args.enabled)
  if (gate) return gate
  const manifest = await args.ports.loadManifest(args.clientId)
  const subject = weekPackSubject(manifest.client_id, manifest.week_start)
  if (manifest.story.read_state !== 'ok') {
    return {
      httpStatus: 409,
      message: 'Story 读不到，没有停。不要当成已经停干净了。',
      manifest,
      card: null,
      receipt: receiptOf(args.clientId, subject, null, []),
    }
  }
  const lines = [await stopStory(manifest, args.ports), postLine(), reelsStayLine()]
  return {
    httpStatus: 200, message: null, manifest, card: null,
    receipt: receiptOf(args.clientId, subject, null, lines),
  }
}

function gateClick(clicker: CardClicker, clientId: string, enabled: boolean): FlowResult | null {
  try {
    assertMayClick(clicker, clientId)
  } catch (error) {
    return refused(error)
  }
  return enabled ? null : disabled(clientId)
}

async function factsFor(clientId: string, manifest: WeekPackManifest, ports: WeekPackPorts) {
  const accountLabel = await ports.accountLabel(clientId)
  return buildWeekPackFacts({ manifest, accountLabel, reelGoPublic: ports.reelGoPublic })
}

function sameList(built: { fingerprint: string; digest: string; facts: CardFacts }, fingerprint: string): boolean {
  return built.fingerprint === fingerprint && scopeHasDigest(built.facts.scope, built.digest)
}

async function applyConfirmed(
  manifest: WeekPackManifest,
  ports: WeekPackPorts,
  tokens: ReadonlyMap<string, string>,
): Promise<WeekPackLine[]> {
  const story = await runStoryLine(manifest, (packId, hash) => ports.authorizeStory(packId, hash))
  const reels = await runReelLines(
    manifest,
    ports.reelGoPublic,
    tokens,
    (workOrderId, previewToken) => ports.promoteReel(workOrderId, previewToken),
  )
  return [story, postLine(), ...reels]
}

async function stopStory(manifest: WeekPackManifest, ports: WeekPackPorts): Promise<WeekPackLine> {
  if (!manifest.story.pack_id) {
    return { kind: 'story', stable_id: null, code: 'nothing', ok: true, text: '没有可停的 Story 周包。' }
  }
  try {
    const result = await ports.revokeStory(manifest.story.pack_id, '整包停掉还没发出去的')
    return revokeLine(manifest.story.pack_id, result)
  } catch {
    return { kind: 'story', stable_id: manifest.story.pack_id, code: 'failed', ok: false, text: '没停成。' }
  }
}

function revokeLine(packId: string, result: RevokeStoryResult): WeekPackLine {
  if (result.code === 'revoked' && result.summaryAvailable) {
    return {
      kind: 'story', stable_id: packId, code: 'revoked', ok: true,
      text: `没发出去的已停。已经发出 ${result.sent} 条收不回，还有 ${result.inFlight} 条正在发。`,
    }
  }
  if (result.code === 'revoked') {
    return {
      kind: 'story', stable_id: packId, code: 'revoked', ok: true,
      text: '已经停了，但读不到发出了几条，不要当成 0 条。',
    }
  }
  if (result.code === 'nothing') {
    return { kind: 'story', stable_id: packId, code: 'nothing', ok: true, text: '没有还在生效的 Story 授权。' }
  }
  if (result.code === 'forbidden') {
    return { kind: 'story', stable_id: packId, code: 'forbidden', ok: false, text: '停 Story 仍要全局管理员。' }
  }
  return { kind: 'story', stable_id: packId, code: 'failed', ok: false, text: '没停成。' }
}

function reelsStayLine(): WeekPackLine {
  return {
    kind: 'reel', stable_id: null, code: 'reel_not_recalled', ok: true,
    text: '已经公开的视频收不回，要到主页处理。没公开的仍是草稿。',
  }
}

function receiptOf(clientId: string, subject: string, runId: string | null, lines: WeekPackLine[]): WeekPackReceipt {
  return { client_id: clientId, subject_key: subject, run_id: runId, rolled_back: false, lines }
}

function done(
  clientId: string,
  manifest: WeekPackManifest,
  card: ConfirmationCardView,
  subject: string,
  lines: WeekPackLine[],
): FlowResult {
  return { httpStatus: 200, message: null, manifest, card, receipt: receiptOf(clientId, subject, card.runId, lines) }
}

function stopped(clientId: string, manifest: WeekPackManifest, card: ConfirmationCardView, subject: string): FlowResult {
  return {
    httpStatus: 200,
    message: card.statusLine,
    manifest,
    card,
    receipt: receiptOf(clientId, subject, card.runId, []),
  }
}

function changed(clientId: string, manifest: WeekPackManifest): FlowResult {
  return {
    httpStatus: 409,
    message: '清单变了，请刷新后再点。这一下没有授权，也没有公开。',
    manifest,
    card: null,
    receipt: receiptOf(clientId, weekPackSubject(manifest.client_id, manifest.week_start), null, []),
  }
}

function disabled(clientId: string): FlowResult {
  return {
    httpStatus: 409,
    message: '整包批准还没打开，没有授权，也没有公开。',
    manifest: null,
    card: null,
    receipt: receiptOf(clientId, '', null, []),
  }
}

function refused(error: unknown): FlowResult {
  if (error instanceof ConfirmationCardError) {
    return { httpStatus: error.status, message: error.humanReason, manifest: null, card: null, receipt: null }
  }
  throw error
}
