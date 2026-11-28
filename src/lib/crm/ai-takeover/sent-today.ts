import type { SupabaseClient } from '@supabase/supabase-js'
import { todayInZone } from '@/lib/crm/email-templates/send-gates'

/**
 * Catalogue sends today (sent, or outcome not yet known), counted in the client's own day.
 * One definition for the release list and for the reminder bar, so "today's room" is the same number on both.
 */
export async function cataloguesSentToday(db: SupabaseClient, clientId: string, timeZone: string, today: string): Promise<number> {
  const { data, error } = await db.from('crm_email_send_receipts').select('created_at')
    .eq('client_id', clientId).like('template_key', 'catalogue%').in('outcome', ['sent', 'unknown'])
    .gte('created_at', new Date(Date.now() - 36 * 3_600_000).toISOString()).limit(1000)
  if (error) throw new Error(`crm_email_send_receipts: ${error.message}`)
  return ((data ?? []) as Array<{ created_at: string }>).filter((r) => todayInZone(new Date(r.created_at), timeZone) === today).length
}
