/**
 * AI 起草「第一封邮件」—— 只出草稿，不发。员工看过、改过、自己点发送才会发出去。
 *
 * 读：这个人的触点（表单 / 来电 / 其他渠道）和各渠道对话原文 + 客户身份 + 已批准的客户事实。
 * 不读任何一个客户的名字、行业事实：身份来自 `clients`，事实来自知识库（跟简报同一条路）。
 */

import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { askJson, type AskJsonDeps } from '@/lib/ai/failover'
import {
  clientFactsBlock,
  currencyRuleFor,
  loadClientFacts,
  loadClientIdentity,
} from '@/lib/messenger/brief'
import { extractCustomColumns, type TouchpointForColumn } from '@/lib/crm/table-columns'
import { humanizeFormCode, humanizeFormSummary } from '@/lib/crm/returning-lead'

export const EmailDraftSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
})
export type EmailDraft = z.infer<typeof EmailDraftSchema>

const EMAIL_DRAFT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: {
    subject: { type: 'string', description: 'Short, plain email subject line (no emoji).' },
    body: { type: 'string', description: 'Plain-text email body, English, ready for a staff member to review.' },
  },
} as const

export type DraftFailure = 'contact_not_found' | 'no_ai' | 'facts_unreadable'

export type DraftResult =
  | { ok: true; draft: EmailDraft }
  | { ok: false; reason: DraftFailure; message: string }

const RAW_LIMIT = 500
const MAX_TOUCHES = 12
const MAX_MESSAGES = 12

interface TouchRow {
  channel: string
  direction: string
  occurred_at: string
  summary: string | null
  raw: string | null
  metadata: Record<string, unknown> | null
}

interface MessageRow {
  direction: string
  sender_name: string | null
  body: string | null
  sent_at: string
}

function clip(text: string | null | undefined, max: number): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 把触点和对话渲染成给模型看的「已知情况」。只写客人自己说过 / 填过的，原样不加工。 */
export function renderKnownContext(
  contactName: string | null,
  touches: TouchRow[],
  messages: MessageRow[],
  business: string,
): string {
  const forColumns: TouchpointForColumn[] = touches.map((t) => ({
    channel: t.channel,
    occurredAt: t.occurred_at,
    metadata: t.metadata,
  }))
  const tour = extractCustomColumns(forColumns).tour_interest
  const lines: string[] = [`Customer name on file: ${contactName?.trim() || '(unknown)'}`]
  const tourText = humanizeFormCode(tour)
  if (tourText) lines.push(`Tour the customer picked or asked about: ${tourText}`)

  const touchLines = touches.slice(0, MAX_TOUCHES).map((t) => {
    const who = t.direction === 'inbound' ? 'Customer' : business
    const what = humanizeFormSummary(t.summary) ?? ''
    const raw = clip(t.raw, RAW_LIMIT)
    return `- [${t.occurred_at.slice(0, 10)}] ${t.channel}, ${who}: ${what}${raw ? ` | ${raw}` : ''}`.trim()
  })
  if (touchLines.length > 0) lines.push('Touchpoints (newest first):', ...touchLines)

  const msgLines = messages.slice(0, MAX_MESSAGES).map((m) => {
    const who = m.direction === 'inbound' ? (m.sender_name ?? 'Customer') : business
    return `- [${m.sent_at.slice(0, 10)}] ${who}: ${clip(m.body, RAW_LIMIT)}`
  })
  if (msgLines.length > 0) lines.push('Messages in other channels (newest first):', ...msgLines)

  return lines.join('\n')
}

export function buildDraftSystemPrompt(business: string, country: string | null | undefined, factsBlock: string): string {
  return `You write the FIRST outbound email from ${business} to someone who enquired with us. A ${business} staff member will read and edit it before sending — you never send anything.

STYLE
- English, warm and plain, 80–140 words. Open with the customer's first name ("Hi Nicole,"), sign off as "${business}" (no personal name, no phone number, no email address).
- Reply to what the customer actually asked or picked. End with ONE clear, easy next step or question.
- Plain text only: no markdown, no bullet symbols, no emoji, no placeholders in square brackets.

${currencyRuleFor(country).replace('in the Chinese fields', 'in the email')}GROUNDING — the mistake that makes a draft dangerous:
- Use only what is in "Known situation" and CLIENT FACTS. Never invent prices, dates, availability, inclusions, discounts or deadlines. If the customer needs a price or date we do not have, say a ${business} team member will confirm it — do not guess.
- Never promise something we cannot see we can do (callbacks at a time, holds, refunds).
- If you do not know the customer's name, open with "Hi there,".
- If refunds, cancellations, payment, insurance, medical or accessibility needs or a complaint are involved, do not try to resolve them: say a ${business} specialist will come back to them.
${factsBlock}`
}

export interface DraftDeps {
  askJson?: AskJsonDeps
  signal?: AbortSignal
}

export async function generateFirstEmailDraft(
  clientId: string,
  contactId: string,
  deps: DraftDeps = {},
): Promise<DraftResult> {
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('display_name')
    .eq('client_id', clientId)
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) return { ok: false, reason: 'contact_not_found', message: '找不到这位客人。' }

  const [{ data: touches }, { data: convs }] = await Promise.all([
    supabaseAdmin
      .from('contact_touchpoints')
      .select('channel, direction, occurred_at, summary, raw, metadata')
      .eq('client_id', clientId)
      .eq('contact_id', contactId)
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabaseAdmin.from('conversations').select('id').eq('client_id', clientId).eq('contact_id', contactId).limit(20),
  ])
  const convIds = ((convs as Array<{ id: string }> | null) ?? []).map((c) => c.id)
  let messages: MessageRow[] = []
  if (convIds.length > 0) {
    const { data: msgs } = await supabaseAdmin
      .from('conversation_messages')
      .select('direction, sender_name, body, sent_at')
      .in('conversation_id', convIds)
      .order('sent_at', { ascending: false })
      .limit(MAX_MESSAGES)
    messages = (msgs as MessageRow[] | null) ?? []
  }

  const identity = await loadClientIdentity(clientId)
  const facts = await loadClientFacts(clientId)
  // 知识库读失败 = 没人能保证草稿里的事实可信，宁可不出草稿（跟简报的 draft_reply 同一条规矩）。
  if (facts.status === 'read_failed') {
    return { ok: false, reason: 'facts_unreadable', message: '系统暂时读不到公司资料，没法起草，请自己写或稍后再试。' }
  }

  const known = renderKnownContext(
    (contact as { display_name: string | null }).display_name,
    (touches as TouchRow[] | null) ?? [],
    messages,
    identity.name,
  )

  try {
    const answer = await askJson(
      {
        system: buildDraftSystemPrompt(identity.name, identity.country, clientFactsBlock(facts.entries)),
        user: `Known situation:\n${known}`,
        schema: EmailDraftSchema,
        jsonSchema: { name: 'first_email_draft', schema: EMAIL_DRAFT_JSON_SCHEMA as unknown as Record<string, unknown> },
        totalBudgetMs: 25_000,
        signal: deps.signal,
        bypassGateway: true,
        openaiModel: process.env.MESSENGER_BRIEF_MODEL ?? 'gpt-4o-mini',
      },
      deps.askJson,
    )
    return { ok: true, draft: { subject: answer.data.subject.trim(), body: answer.data.body.trim() } }
  } catch (err) {
    console.error('[crm/email-draft] AI 起草失败:', err instanceof Error ? err.message : err)
    return { ok: false, reason: 'no_ai', message: 'AI 暂时起草不出来，请自己写或稍后再试。' }
  }
}
