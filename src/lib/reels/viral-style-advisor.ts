/**
 * Viral Style Advisor — Phase 11.0-R
 *
 * Queries the viral reference library and formats a style hint
 * for injection into the Reel generation prompt.
 */

import { supabaseAdmin } from '@/lib/supabase'

/**
 * Returns a formatted style guidance block for the given industry,
 * or null if no analyzed references exist yet.
 */
export async function getViralStyleHint(industry: string): Promise<string | null> {
  const { data: refs } = await supabaseAdmin
    .from('viral_reference_library')
    .select('style_description, style_tags, key_techniques, persona_fit')
    .eq('industry', industry)
    .eq('analysis_status', 'done')
    .order('created_at', { ascending: false })
    .limit(5)

  if (!refs || refs.length === 0) return null

  const examples = refs
    .filter(r => r.style_description)
    .map((r, i) => {
      const parts: string[] = [`${i + 1}. ${r.style_description}`]
      if (r.key_techniques?.length) parts.push(`   Techniques: ${r.key_techniques.join(', ')}`)
      if (r.style_tags?.length)     parts.push(`   Tags: ${r.style_tags.join(', ')}`)
      return parts.join('\n')
    })

  if (examples.length === 0) return null

  return [
    `## Proven ${industry} Video Style References`,
    `Study these high-performing video patterns and incorporate their best elements naturally:`,
    '',
    ...examples,
    '',
    `Apply the energy, visual language, and techniques above to this brief.`,
  ].join('\n')
}
