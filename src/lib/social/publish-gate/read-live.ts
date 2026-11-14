/**
 * Read one client's publish switch. A missing row or a missing key is off.
 * A database error is thrown so the caller cannot treat "unreadable" as off-and-done.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishLiveEnabled, type PublishLiveKind } from './switches'

export async function readPublishLive(
  supabase: SupabaseClient,
  clientId: string,
  kind: PublishLiveKind,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('clients')
    .select('publishing_calendar_config')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new Error(`readPublishLive: ${error.message}`)
  const config = (data as { publishing_calendar_config?: unknown } | null)?.publishing_calendar_config
  return publishLiveEnabled(config, kind)
}
