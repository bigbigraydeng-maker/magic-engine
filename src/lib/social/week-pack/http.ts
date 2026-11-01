/**
 * HTTP shape for the weekly pack. The page renders `lines` and `receipt_lines` only.
 */

import type { CardClicker } from '@/lib/confirmation-card/actor'

import { confirmWeekPack, declineWeekPack, openWeekPack, revokeWeekPack, type FlowResult, type WeekPackPorts } from './flow'
import { toWeekPackPage, type WeekPackPage } from './view'

const COMMAND_KEYS = new Set(['action', 'run_id', 'fingerprint', 'expected_decision_id', 'preview_tokens'])
const TOKEN_KEYS = new Set(['work_order_id', 'preview_token'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PageContext {
  enabled: boolean
  reelGoPublic: boolean
  configReadable: boolean
  clientId: string
  clicker: CardClicker
  ports: WeekPackPorts
}

export interface WeekPackCommand {
  action: 'confirm' | 'decline' | 'revoke'
  runId: string
  fingerprint: string
  expectedDecisionId: string
  tokens: Map<string, string>
}

export async function handleWeekPackGet(ctx: PageContext): Promise<{ status: number; body: WeekPackPage | { success: false; error: string } }> {
  try {
    const result = await openWeekPack({ enabled: ctx.enabled, clientId: ctx.clientId, ports: ctx.ports })
    return asPage(ctx, result)
  } catch (error) {
    console.error('[week-pack] open failed', error instanceof Error ? error.message : 'unknown')
    return { status: 500, body: { success: false, error: '整包读不出来，请刷新。不要当成这一周没有内容。' } }
  }
}

export async function handleWeekPackPost(
  ctx: PageContext,
  command: WeekPackCommand,
): Promise<{ status: number; body: WeekPackPage | { success: false; error: string } }> {
  try {
    const result = await runCommand(ctx, command)
    return asPage(ctx, result)
  } catch (error) {
    console.error('[week-pack] decide failed', error instanceof Error ? error.message : 'unknown')
    return { status: 500, body: { success: false, error: '没点成，请刷新后再试。' } }
  }
}

async function runCommand(ctx: PageContext, command: WeekPackCommand): Promise<FlowResult> {
  if (command.action === 'revoke') {
    return revokeWeekPack({ enabled: ctx.enabled, clientId: ctx.clientId, clicker: ctx.clicker, ports: ctx.ports })
  }
  const shared = {
    enabled: ctx.enabled,
    clientId: ctx.clientId,
    clicker: ctx.clicker,
    runId: command.runId,
    expectedDecisionId: command.expectedDecisionId,
    fingerprint: command.fingerprint,
    ports: ctx.ports,
  }
  if (command.action === 'decline') return declineWeekPack(shared)
  return confirmWeekPack({ ...shared, tokens: command.tokens })
}

function asPage(ctx: PageContext, result: FlowResult): { status: number; body: WeekPackPage | { success: false; error: string } } {
  if (result.httpStatus !== 200) {
    return { status: result.httpStatus, body: { success: false, error: result.message ?? '没做成。' } }
  }
  return {
    status: 200,
    body: toWeekPackPage({
      enabled: ctx.enabled,
      reelGoPublic: ctx.reelGoPublic,
      configReadable: ctx.configReadable,
      cadence: ctx.ports.cadence(),
      manifest: result.manifest,
      card: result.card,
      message: result.message,
      receipt: result.receipt,
    }),
  }
}

export function parseWeekPackCommand(raw: unknown): WeekPackCommand | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: '请求内容读不懂，没有收下。' }
  const body = raw as Record<string, unknown>
  for (const key of Object.keys(body)) {
    if (!COMMAND_KEYS.has(key)) return { error: '请求里有不认识的内容，没有收下。' }
  }
  if (body.action !== 'confirm' && body.action !== 'decline' && body.action !== 'revoke') {
    return { error: '只能同意、先不发，或停掉还没发出去的。' }
  }
  const tokens = readTokens(body.preview_tokens)
  if ('error' in tokens) return tokens
  if (body.action === 'revoke') {
    return { action: 'revoke', runId: '', fingerprint: '', expectedDecisionId: '', tokens: tokens.tokens }
  }
  if (typeof body.run_id !== 'string' || typeof body.fingerprint !== 'string' || typeof body.expected_decision_id !== 'string') {
    return { error: '这张卡的编号不齐，没有点成。' }
  }
  return {
    action: body.action,
    runId: body.run_id,
    fingerprint: body.fingerprint,
    expectedDecisionId: body.expected_decision_id,
    tokens: tokens.tokens,
  }
}

function readTokens(raw: unknown): { tokens: Map<string, string> } | { error: string } {
  if (raw == null) return { tokens: new Map() }
  if (!Array.isArray(raw) || raw.length > 30) return { error: '预览记录读不懂，没有公开。' }
  const tokens = new Map<string, string>()
  for (const item of raw) {
    const one = oneToken(item)
    if ('error' in one) return one
    tokens.set(one.workOrderId, one.previewToken)
  }
  return { tokens }
}

function oneToken(item: unknown): { workOrderId: string; previewToken: string } | { error: string } {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: '预览记录读不懂，没有公开。' }
  const row = item as Record<string, unknown>
  for (const key of Object.keys(row)) {
    if (!TOKEN_KEYS.has(key)) return { error: '预览记录里有不认识的内容，没有公开。' }
  }
  if (typeof row.work_order_id !== 'string' || !UUID_RE.test(row.work_order_id)) {
    return { error: '有一条视频对不上，没有公开。' }
  }
  if (typeof row.preview_token !== 'string' || row.preview_token.length < 8 || row.preview_token.length > 200) {
    return { error: '有一条预览已经不能用，请重新预览。' }
  }
  return { workOrderId: row.work_order_id, previewToken: row.preview_token }
}
