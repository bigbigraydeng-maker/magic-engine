/**
 * Viral Style Advisor — Phase 11.0-R
 *
 * Queries the viral reference library by industry + content_goal,
 * orders by view_count (most viral first), formats a style hint block
 * for injection into the Reel generation prompt.
 */

import { supabaseAdmin } from '@/lib/supabase'

export type ContentGoal = 'brand' | 'sales' | 'ugc' | 'education'

/**
 * Returns a formatted style guidance block, or null if no done references exist.
 * References are ordered by view_count desc — most viral examples weigh heaviest.
 */
export async function getViralStyleHint(
  industry: string,
  contentGoal: ContentGoal = 'brand'
): Promise<string | null> {
  // Try with exact content_goal match first
  let { data: refs } = await supabaseAdmin
    .from('viral_reference_library')
    .select('style_description, style_tags, key_techniques, persona_fit, view_count, video_title, channel_title')
    .eq('industry', industry)
    .eq('analysis_status', 'done')
    .eq('content_goal', contentGoal)
    .order('view_count', { ascending: false, nullsFirst: false })
    .limit(5)

  // Fallback: if no goal-specific refs, fall back to any so we always inject some signal
  if (!refs || refs.length === 0) {
    const fallback = await supabaseAdmin
      .from('viral_reference_library')
      .select('style_description, style_tags, key_techniques, persona_fit, view_count, video_title, channel_title')
      .eq('industry', industry)
      .eq('analysis_status', 'done')
      .order('view_count', { ascending: false, nullsFirst: false })
      .limit(5)
    refs = fallback.data ?? null
  }

  if (!refs || refs.length === 0) return null

  const examples = refs
    .filter(r => r.style_description)
    .map((r, i) => {
      const parts: string[] = []
      const viewBadge = r.view_count
        ? ` [${formatViewCount(r.view_count)} views]`
        : ''
      parts.push(`${i + 1}.${viewBadge} ${r.style_description}`)
      if (r.key_techniques?.length) parts.push(`   Techniques: ${r.key_techniques.join(', ')}`)
      if (r.style_tags?.length)     parts.push(`   Tags: ${r.style_tags.join(', ')}`)
      return parts.join('\n')
    })

  if (examples.length === 0) return null

  const goalLabel = contentGoal === 'sales'     ? 'Sales/Conversion'
                  : contentGoal === 'ugc'       ? 'UGC/Social Proof'
                  : contentGoal === 'education' ? 'Educational'
                  : 'Brand/Inspiration'

  return [
    `## Proven ${industry} ${goalLabel} Video Style References`,
    `Study these high-performing video patterns (ranked by view count) and incorporate their best elements naturally:`,
    '',
    ...examples,
    '',
    `Apply the energy, visual language, and techniques above to this brief.`,
  ].join('\n')
}

function formatViewCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * Detect content goal from campaign brief fields.
 * Sales signals: explicit offer + action-oriented CTA, or urgency words in angle.
 */
export function detectContentGoal(brief: {
  offer?: string | null
  primary_cta?: string | null
  campaign_angle?: string | null
  channel_goal?: string | null
}): ContentGoal {
  const offer       = (brief.offer ?? '').trim()
  const cta         = (brief.primary_cta ?? '').trim().toLowerCase()
  const angle       = (brief.campaign_angle ?? '').toLowerCase()
  const channelGoal = (brief.channel_goal ?? '').toLowerCase()

  const SALES_CTA_VERBS = ['book', 'buy', 'reserve', 'get', 'shop', 'order', 'claim', 'grab']
  const hasActionCta = SALES_CTA_VERBS.some(v => cta.includes(v))
  const hasOffer = offer.length > 0 && !/awareness|brand|generic/i.test(offer)

  const URGENCY_WORDS = ['limited', 'last chance', 'ending', 'expires', 'today', 'now', 'hurry', 'deal']
  const hasUrgency = URGENCY_WORDS.some(w => angle.includes(w) || channelGoal.includes(w))

  if ((hasOffer && hasActionCta) || hasUrgency) return 'sales'

  return 'brand'
}
