export type RecipePlatform = 'facebook' | 'instagram' | 'tiktok'
export type PlatformStatus = 'implemented' | 'not_connected'
export type NeverAutoReplyTopic = 'price' | 'complaint' | 'refund'

export interface HardRule {
  key: string
  description: string
}

export interface PlatformRuleSet {
  platform: RecipePlatform
  status: PlatformStatus
  rules: readonly HardRule[]
  neverAutoReplyTopics: readonly NeverAutoReplyTopic[]
}

const FACEBOOK_RULES: readonly HardRule[] = [
  {
    key: 'link_in_first_comment',
    description:
      'The call-to-action link goes in the first comment, never in the post body.',
  },
  {
    key: 'unreadable_metrics_not_for_acceptance',
    description:
      'A metric the system cannot read is never used for acceptance.',
  },
  {
    key: 'story_not_for_selling',
    description:
      'Story is reminder and companionship, not selling.',
  },
  {
    key: 'never_auto_reply_price_complaint_refund',
    description:
      'Price, complaint and refund messages are never auto-replied; they go to a human.',
  },
  {
    key: 'groups_me_drafts_human_posts',
    description:
      'For groups, ME only drafts; a human posts.',
  },
  {
    key: 'marketplace_no_tours',
    description:
      'Marketplace only allows physical goods; tours or services must not be listed.',
  },
]

const FACEBOOK_NEVER_AUTO_REPLY: readonly NeverAutoReplyTopic[] = [
  'price',
  'complaint',
  'refund',
]

export const PLATFORM_RULES: Record<RecipePlatform, PlatformRuleSet> = {
  facebook: {
    platform: 'facebook',
    status: 'implemented',
    rules: FACEBOOK_RULES,
    neverAutoReplyTopics: FACEBOOK_NEVER_AUTO_REPLY,
  },
  instagram: {
    platform: 'instagram',
    status: 'not_connected',
    rules: [],
    neverAutoReplyTopics: [],
  },
  tiktok: {
    platform: 'tiktok',
    status: 'not_connected',
    rules: [],
    neverAutoReplyTopics: [],
  },
}

export function platformRulesFor(platform: RecipePlatform): PlatformRuleSet {
  return PLATFORM_RULES[platform]
}
