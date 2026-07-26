import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import {
  shouldGenerateBrief,
  generateBrief,
  storeBrief,
  type BriefCandidate,
  type StoredMessage,
} from '@/lib/messenger/brief'

/**
 * GET /api/cron/messenger-brief-hourly
 *
 * Hourly cron — writes the customer brief for every settled Messenger thread
 * that has moved on since its last brief. Trigger rules live in lib/messenger/brief.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 800

/**
 * Ceiling on model calls per run. A backlog drains over subsequent hours rather
 * than turning one bad run into an unbounded bill.
 */
const MAX_BRIEFS_PER_RUN = 50

interface ConversationRow {
  id: string
  client_id: string
  message_count: number
  last_message_at: string | null
  last_message_from: string | null
  messenger_briefs: {
    source_message_count: number
    regen_count: number
    regen_count_date: string | null
  }[]
}

function toCandidate(row: ConversationRow): BriefCandidate {
  const brief = row.messenger_briefs?.[0]
  return {
    conversationId: row.id,
    clientId: row.client_id,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    existingBriefMessageCount: brief?.source_message_count ?? null,
    regenCount: brief?.regen_count ?? 0,
    regenCountDate: brief?.regen_count_date ?? null,
  }
}

async function loadMessages(conversationId: string): Promise<StoredMessage[]> {
  const { data } = await supabaseAdmin
    .from('messenger_messages')
    .select('direction, sender_name, body, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })

  return (data ?? []).map((m) => ({
    direction: m.direction as 'inbound' | 'outbound',
    senderName: m.sender_name,
    body: m.body ?? '',
    sentAt: m.sent_at,
  }))
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const run = await startCronRun('messenger-brief-hourly')
  const now = new Date()

  const { data, error } = await supabaseAdmin
    .from('messenger_conversations')
    .select(
      'id, client_id, message_count, last_message_at, last_message_from, messenger_briefs(source_message_count, regen_count, regen_count_date)',
    )
    .gt('message_count', 0)
    .order('last_message_at', { ascending: false })
    .limit(500)

  if (error) {
    await run.finish({ error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as ConversationRow[]
  const byId = new Map(rows.map((r) => [r.id, r]))

  const due = rows
    .map(toCandidate)
    .filter((c) => shouldGenerateBrief(c, now))
    .slice(0, MAX_BRIEFS_PER_RUN)

  let generated = 0
  let failed = 0

  for (const candidate of due) {
    try {
      const messages = await loadMessages(candidate.conversationId)
      if (messages.length === 0) continue
      const row = byId.get(candidate.conversationId)!
      const brief = await generateBrief(messages, {
        awaitingReply: row.last_message_from === 'customer',
        hoursSinceLastMessage: candidate.lastMessageAt
          ? Math.round((now.getTime() - new Date(candidate.lastMessageAt).getTime()) / 3_600_000)
          : 0,
      })
      await storeBrief(candidate, brief, now)
      generated++
    } catch (err) {
      failed++
      console.error(`[messenger/brief] ${candidate.conversationId} failed:`, err)
    }
  }

  await run.finish({
    processed: due.length,
    completed: generated,
    failed,
    summary: { candidates: due.length, generated, failed, capped: MAX_BRIEFS_PER_RUN },
  })

  return NextResponse.json({ ok: true, candidates: due.length, generated, failed })
}
