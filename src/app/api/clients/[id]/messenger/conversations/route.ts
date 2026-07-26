/**
 * GET /api/clients/[id]/messenger/conversations
 *
 * The salesperson's worklist: every Messenger thread for this client, with its
 * customer brief and how long is left to reply inside Meta's window.
 *
 * Ordered so the people waiting on us come first, then by how recently they
 * spoke — a salesperson opening this on their phone should not have to sort.
 *
 * Responses:
 *   200  { conversations: [...] }
 *   401  not authenticated
 *   403  not a member of this client
 *   500  query failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { messagingWindow } from '@/lib/messenger/send'

interface RouteParams {
  params: { id: string }
}

interface BriefRow {
  summary: string
  intent_level: string
  customer_needs: string[]
  objections: string[]
  promises_made: string[]
  next_action: string | null
  risk_flags: string[]
  trip: Record<string, unknown>
  contact: Record<string, unknown>
  draft_reply: string | null
  generated_at: string
}

interface ConversationRow {
  id: string
  participant_name: string | null
  message_count: number
  last_message_at: string | null
  last_message_from: string | null
  messenger_briefs: BriefRow[]
}

const INTENT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, unknown: 3 }

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // client_id is filtered here, never taken from anything the caller controls
  // beyond the id the guard above already verified membership for.
  const { data, error } = await supabaseAdmin
    .from('messenger_conversations')
    .select(
      'id, participant_name, message_count, last_message_at, last_message_from, ' +
        'messenger_briefs(summary, intent_level, customer_needs, objections, promises_made, next_action, risk_flags, trip, contact, draft_reply, generated_at)',
    )
    .eq('client_id', clientId)
    .order('last_message_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = new Date()
  const conversations = ((data ?? []) as unknown as ConversationRow[]).map((row) => {
    const brief = row.messenger_briefs?.[0] ?? null
    const awaitingReply = row.last_message_from === 'customer'
    // The window runs off the customer's last message. When they spoke last that
    // is last_message_at; otherwise this list view cannot know it without a
    // second query, so the detail view is authoritative for the countdown.
    const window = awaitingReply ? messagingWindow(row.last_message_at, now) : null

    return {
      id: row.id,
      participantName: row.participant_name,
      messageCount: row.message_count,
      lastMessageAt: row.last_message_at,
      awaitingReply,
      hoursWaiting:
        awaitingReply && row.last_message_at
          ? Math.round((now.getTime() - new Date(row.last_message_at).getTime()) / 3_600_000)
          : null,
      replyWindow: window ? { kind: window.kind, msRemaining: window.msRemaining } : null,
      brief,
    }
  })

  conversations.sort((a, b) => {
    // Threads waiting on us always float to the top.
    if (a.awaitingReply !== b.awaitingReply) return a.awaitingReply ? -1 : 1
    const rank =
      (INTENT_RANK[a.brief?.intent_level ?? 'unknown'] ?? 3) -
      (INTENT_RANK[b.brief?.intent_level ?? 'unknown'] ?? 3)
    if (rank !== 0) return rank
    return (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')
  })

  return NextResponse.json({
    conversations,
    // Two CTS mailboxes share this screen and every send is filed under whoever
    // is signed in, so the page states which account is about to speak.
    viewerEmail: access.user.email ?? null,
    counts: {
      total: conversations.length,
      awaitingReply: conversations.filter((c) => c.awaitingReply).length,
      highIntent: conversations.filter((c) => c.brief?.intent_level === 'high').length,
    },
  })
}
