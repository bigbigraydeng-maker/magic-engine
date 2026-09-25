import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { sendMailReply } from '@/lib/microsoft/mail-send'

type Context = { params: Promise<{ id: string }> }

const replySchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1),
  agentCustomerId: z.string().uuid().nullable().optional(),
})

export async function POST(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const sentByEmail = access.user?.email
  if (!sentByEmail) {
    return NextResponse.json({ error: 'Session missing email' }, { status: 400 })
  }

  let parsed: z.infer<typeof replySchema>
  try {
    parsed = replySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const result = await sendMailReply({
    clientId: id,
    conversationId: parsed.conversationId,
    body: parsed.body,
    sentByEmail,
    usedAiDraft: false,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status })
  }

  if (parsed.agentCustomerId) {
    try {
      await supabaseAdmin
        .from('agent_customers')
        .update({
          last_contact_at: new Date().toISOString(),
          last_contact_summary: parsed.body.slice(0, 200),
          updated_at: new Date().toISOString(),
        })
        .eq('id', parsed.agentCustomerId)
        .eq('client_id', id)
    } catch {
      // Reply already sent; do not fail the request over a bookkeeping update.
    }
  }

  return NextResponse.json({ ok: true, messageId: result.messageId })
}
