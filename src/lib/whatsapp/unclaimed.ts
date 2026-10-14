import { supabaseAdmin } from '@/lib/supabase'

export type UnclaimedKind = 'customer_messages' | 'echoes' | 'statuses' | 'history'

const PHONE_NUMBER_ID_PATTERN = /^[0-9]{1,32}$/

const LOG_TEXT = '[whatsapp/unclaimed] registry write failed'

export async function recordUnclaimedNumber(
  phoneNumberId: string,
  kind: UnclaimedKind,
  now?: Date,
): Promise<void> {
  if (!PHONE_NUMBER_ID_PATTERN.test(phoneNumberId)) {
    return
  }

  try {
    const { error } = await supabaseAdmin
      .from('whatsapp_unclaimed_numbers')
      .upsert(
        {
          phone_number_id: phoneNumberId,
          last_seen_at: (now ?? new Date()).toISOString(),
          last_kind: kind,
          resolved_at: null,
        },
        { onConflict: 'phone_number_id' },
      )

    if (error) {
      console.error(LOG_TEXT)
    }
  } catch {
    console.error(LOG_TEXT)
  }
}
