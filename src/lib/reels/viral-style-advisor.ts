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
  // Filter: only learnable (good views) and NOT our own videos
  const FIELDS = 'style_description, style_tags, key_techniques, persona_fit, view_count, video_title, channel_title, opening_hook'

  let { data: refs } = await supabaseAdmin
    .from('viral_reference_library')
    .select(FIELDS)
    .eq('industry', industry)
    .eq('analysis_status', 'done')
    .eq('content_goal', contentGoal)
    .eq('is_learnable', true)
    .eq('is_our_video', false)
    .order('view_count', { ascending: false, nullsFirst: false })
    .limit(5)

  // Fallback: if no goal-specific refs, fall back to any goal (but still learnable + not ours)
  if (!refs || refs.length === 0) {
    const fallback = await supabaseAdmin
      .from('viral_reference_library')
      .select(FIELDS)
      .eq('industry', industry)
      .eq('analysis_status', 'done')
      .eq('is_learnable', true)
      .eq('is_our_video', false)
      .order('view_count', { ascending: false, nullsFirst: false })
      .limit(5)
    refs = fallback.data ?? null
  }

  if (!refs || refs.length === 0) return null

  // Separate hook data for aggregated summary (top 3 hook types across all refs)
  const hookTypes = refs
    .map(r => (r.opening_hook as { type?: string } | null)?.type)
    .filter((t): t is string => Boolean(t))
  const hookFreq = new Map<string, number>()
  for (const t of hookTypes) hookFreq.set(t, (hookFreq.get(t) ?? 0) + 1)
  const topHooks = Array.from(hookFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)

  const examples = refs
    .filter(r => r.style_description)
    .map((r, i) => {
      const hook = r.opening_hook as { type?: string; script?: string; feel?: string } | null
      const parts: string[] = []
      const viewBadge = r.view_count
        ? ` [${formatViewCount(r.view_count)} views]`
        : ''
      parts.push(`${i + 1}.${viewBadge} ${r.style_description}`)
      if (hook?.type) {
        const hookLine = hook.script
          ? `   Hook (first 1.5s): ${hook.type} — "${hook.script}"${hook.feel ? ` (${hook.feel})` : ''}`
          : `   Hook (first 1.5s): ${hook.type}${hook.feel ? ` (${hook.feel})` : ''}`
        parts.push(hookLine)
      }
      if (r.key_techniques?.length) parts.push(`   Techniques: ${r.key_techniques.join(', ')}`)
      if (r.style_tags?.length)     parts.push(`   Tags: ${r.style_tags.join(', ')}`)
      return parts.join('\n')
    })

  if (examples.length === 0) return null

  const goalLabel = contentGoal === 'sales'     ? 'Sales/Conversion'
                  : contentGoal === 'ugc'       ? 'UGC/Social Proof'
                  : contentGoal === 'education' ? 'Educational'
                  : 'Brand/Inspiration'

  const hookSummaryLine = topHooks.length > 0
    ? `Top opening hook patterns in this industry: ${topHooks.map(([t, n]) => `${t} (×${n})`).join(', ')}.`
    : null

  return [
    `## Proven ${industry} ${goalLabel} Video Style References`,
    `Study these high-performing video patterns (ranked by view count) and incorporate their best elements naturally:`,
    '',
    ...examples,
    '',
    hookSummaryLine
      ? `OPENING HOOK GUIDANCE: ${hookSummaryLine} Mirror the dominant hook style in your opening_frame_prompt and i2v_video_prompt opening section.`
      : null,
    `Apply the energy, visual language, and techniques above to this brief.`,
  ].filter((line): line is string => line !== null).join('\n')
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
