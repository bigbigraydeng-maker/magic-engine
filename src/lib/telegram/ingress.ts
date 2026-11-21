/**
 * Read-only intake of a Telegram update.
 *
 * ME does not call setWebhook. An update may arrive because the existing bot's
 * webhook points here, or because the service that owns the webhook forwards
 * the same JSON with the same X-Telegram-Bot-Api-Secret-Token header.
 * Pointing the bot webhook at ME would replace the current URL.
 *
 * Free text is never an approval. Buttons are not executed in this PR.
 */

import {
  readTelegramOwner,
  secretHeaderMatches,
  telegramWebhookSecret,
  type TelegramOwnerConfig,
} from './config'

export interface InboundActor {
  readonly userId: string
  readonly chatId: string
  readonly kind: 'message' | 'callback'
}

export interface IngressResult {
  readonly status: number
  readonly body: {
    readonly ok: boolean
    readonly error?: string
    readonly executed?: false
    readonly reason?: 'text_is_not_approval' | 'buttons_not_enabled'
    readonly approver?: 'opc' | null
  }
}

const MAX_BODY = 64 * 1024

function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

function actorFromMessage(value: unknown, kind: InboundActor['kind']): InboundActor | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const from = row.from
  const chatSource = kind === 'callback' ? (row.message as Record<string, unknown> | undefined)?.chat : row.chat
  const userId = asId(from && typeof from === 'object' ? (from as Record<string, unknown>).id : null)
  const chatId = asId(chatSource && typeof chatSource === 'object' ? (chatSource as Record<string, unknown>).id : null)
  if (!userId || !chatId) return null
  return { userId, chatId, kind }
}

export function actorFromUpdate(update: unknown): InboundActor | null {
  if (!update || typeof update !== 'object') return null
  const body = update as Record<string, unknown>
  const message = body.message ?? body.edited_message
  if (message) return actorFromMessage(message, 'message')
  if (body.callback_query) return actorFromMessage(body.callback_query, 'callback')
  return null
}

export function isAllowListed(actor: InboundActor, owner: TelegramOwnerConfig): boolean {
  return actor.userId === owner.userId && actor.chatId === owner.chatId
}

/** OPC identity only for the allow-listed owner, and only when an email is configured. */
export function opcApproverFor(actor: InboundActor, owner: TelegramOwnerConfig): { kind: 'opc'; email: string } | null {
  if (!isAllowListed(actor, owner) || !owner.email) return null
  return { kind: 'opc', email: owner.email }
}

export function inspectTelegramUpdate(args: {
  secretHeader: string | null
  rawBody: string
  env?: NodeJS.ProcessEnv
}): IngressResult {
  const env = args.env ?? process.env
  const secret = telegramWebhookSecret(env)
  if (!secret) return { status: 503, body: { ok: false, error: 'secret_not_configured' } }
  if (!secretHeaderMatches(args.secretHeader, secret)) {
    return { status: 401, body: { ok: false, error: 'bad_secret' } }
  }
  if (args.rawBody.length > MAX_BODY) return { status: 413, body: { ok: false, error: 'too_large' } }

  let update: unknown
  try {
    update = JSON.parse(args.rawBody) as unknown
  } catch {
    return { status: 400, body: { ok: false, error: 'bad_json' } }
  }

  const owner = readTelegramOwner(env)
  if (!owner) return { status: 503, body: { ok: false, error: 'owner_not_configured' } }

  const actor = actorFromUpdate(update)
  if (!actor || !isAllowListed(actor, owner)) {
    return { status: 403, body: { ok: false, error: 'not_owner', executed: false } }
  }

  const approver = opcApproverFor(actor, owner) ? 'opc' as const : null
  const reason = actor.kind === 'callback' ? 'buttons_not_enabled' as const : 'text_is_not_approval' as const
  return { status: 200, body: { ok: true, executed: false, reason, approver } }
}
