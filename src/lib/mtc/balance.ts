import { supabaseAdmin } from '@/lib/supabase'
import type { MtcBalanceResult } from './types'

export async function getMtcBalance(clientId: string): Promise<MtcBalanceResult> {
  const { data, error } = await supabaseAdmin
    .from('mtc_purchases')
    .select('id, mtc_remaining, expires_at')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })

  if (error) throw new Error(`MTC balance lookup failed: ${error.message}`)

  const batches = (data ?? []).map((p) => ({
    purchaseId: p.id as string,
    remaining: p.mtc_remaining as number,
    expiresAt: p.expires_at as string,
  }))

  const balance = batches.reduce((sum, b) => sum + b.remaining, 0)
  return { balance, batches }
}
