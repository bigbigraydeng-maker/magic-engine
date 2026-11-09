import type { SupabaseClient } from '@supabase/supabase-js'
import type { DraftKind } from './ad-draft'

// Mirrors ADS_CREATE_ACTION in draft-and-gate.ts; a test pins the equality.
const DRAFT_ACTION_TYPE = 'ads.create_ad'

const MESSENGER_KIND: DraftKind = 'messenger_conversation'

// Real Meta campaign ids are plain digits with no leading zero. Anything else
// is refused rather than compared, so padded / prefixed / zero-led spellings
// cannot slip past an exact-match lookup.
const META_CAMPAIGN_ID_PATTERN = /^[1-9]\d{0,31}$/

export type MessengerDraftCheck =
  | 'is_messenger_draft'
  | 'not_messenger_draft'
  | 'lookup_failed'

export const MESSENGER_REACTIVATE_BLOCKED_MESSAGE =
  '这个广告系列是 ME 建的私信广告，不能用「恢复」直接开启：请重新建草案走审批流程（目前私信广告的开启需要授权人到 Meta 后台手动点开）。'

export const MESSENGER_LOOKUP_FAILED_MESSAGE =
  '暂时查不到这个系列的记录，为安全起见先不恢复：请稍后再点一次，仍不行请联系开发。'

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
  campaignId: string,
): Promise<MessengerDraftCheck> {
  // Reject malformed campaign ids without querying.
  if (typeof campaignId !== 'string' || !META_CAMPAIGN_ID_PATTERN.test(campaignId)) {
    return 'lookup_failed'
  }

  try {
    // No client filter on purpose: Meta campaign ids are globally unique, and a
    // shared ad account lets staff of one client reach another client's
    // campaign, so a draft recorded under any client must block.
    const { data, error } = await supabase
      .from('flywheel_actions')
      .select('id')
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
