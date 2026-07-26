import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncClientMessenger, type MessengerSyncClient } from '@/lib/messenger/sync'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/messenger-sync-hourly
 *
 * Hourly cron — pulls each opted-in client's Facebook Page Messenger inbox into
 * messenger_conversations / messenger_messages.
 *
 * Opt-in is per client: only rows with clients.facebook_page_id set are synced.
 * As of 2026-07-26 that is CTS Tours NZ only.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 600

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const run = await startCronRun('messenger-sync-hourly')

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, facebook_page_id')
    .not('facebook_page_id', 'is', null)

  if (error) {
    await run.finish({ error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = []
  for (const client of (clients ?? []) as MessengerSyncClient[]) {
    results.push(await syncClientMessenger(client))
  }

  const conversations = results.reduce((n, r) => n + r.conversations, 0)
  const messages = results.reduce((n, r) => n + r.messages, 0)
  const failed = results.filter((r) => r.error).length

  await run.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    summary: { conversations, messages, results },
  })

  return NextResponse.json({ ok: true, clients: results.length, conversations, messages, results })
}
