import type { SupabaseClient } from '@supabase/supabase-js'
import type { DraftKind } from './ad-draft'

// Mirrors ADS_CREATE_ACTION in draft-and-gate.ts; a test pins the equality.
const DRAFT_ACTION_TYPE = 'ads.create_ad'

const MESSENGER_KIND: DraftKind = 'messenger_conversation'

export type MessengerDraftCheck =
  | 'is_messenger_draft'
  | 'not_messenger_draft'
  | 'lookup_failed'

export const MESSENGER_REACTIVATE_BLOCKED_MESSAGE =
  '这个广告系列是 ME 建的私信广告，不能用「恢复」直接开启：请重新建草案，走审批流程。'

export const MESSENGER_LOOKUP_FAILED_MESSAGE =
  '查不到这个系列是不是 ME 建的私信广告，为安全起见先不恢复：请稍后重试，或重新建草案走审批流程。'

/**
 * Tells the `ads.reactivate_campaign` route whether a Meta campaign id was
 * created by ME as a Messenger-conversation ad draft.
 *
 * The check is FAIL-CLOSED: only an explicit "no matching draft" answer
 * ('not_messenger_draft') lets the caller proceed. Any error, malformed
 * response, or thrown exception yields 'lookup_failed'.
 */
export async function checkMessengerDraftCampaign(
  supabase: SupabaseClient,
  clientId: string,
  campaignId: string,
): Promise<MessengerDraftCheck> {
  // Reject empty / whitespace-only campaign ids without querying.
  if (typeof campaignId !== 'string' || campaignId.trim().length === 0) {
    return 'lookup_failed'
  }

  try {
    const { data, error } = await supabase
      .from('flywheel_actions')
      .select('id')
      .eq('client_id', clientId)
      .eq('action_type', DRAFT_ACTION_TYPE)
      .eq('payload->draft->>kind', MESSENGER_KIND)
      .eq('payload->>campaignId', campaignId)
      .limit(1)

    if (error) {
      return 'lookup_failed'
    }

    if (!Array.isArray(data)) {
      return 'lookup_failed'
    }

    return data.length > 0 ? 'is_messenger_draft' : 'not_messenger_draft'
  } catch {
    return 'lookup_failed'
  }
}
