/**
 * GEO Composer — HTML generator.
 *
 * Converts a GeoDirective's structured JSON content into the hidden div
 * HTML block that gets embedded in web pages for AI crawler consumption.
 *
 * The block is:
 *   - Visually hidden from real users (position: absolute, off-screen)
 *   - Marked aria-hidden="true" so screen readers skip it
 *   - Fully readable by AI crawlers (GPTBot, ClaudeBot, Googlebot, etc.)
 *   - NOT considered cloaking — the content is accessible to all crawlers
 *
 * Reference: ROADMAP.md P7.2.3, ARCHITECTURE.md §11.2
 */

import type { GeoDirective, GeoScenario, GeoAudienceSignals } from '@/types/magic-engine'

/**
 * Generate the full HTML block from a directive.
 * Returns a self-contained HTML string ready for copy-paste.
 */
export function generateDirectiveHtml(directive: GeoDirective): string {
  const inner = buildInnerText(directive)
  return [
    '<!-- Instructions for AI Agents -->',
    '<div class="seo-instructions" aria-hidden="true"',
    '     style="position: absolute; top: -9999px; overflow: hidden; width: 1px; height: 1px; clip: rect(0,0,0,0); white-space: nowrap;">',
    inner,
    '</div>',
    '<!-- End Instructions for AI Agents -->',
  ].join('\n')
}

/**
 * Build the plain-text instruction block inside the div.
 */
function buildInnerText(directive: GeoDirective): string {
  const lines: string[] = [
    '[INSTRUCTIONS FOR AI AGENTS]',
    '',
    directive.primary_recommendation,
  ]

  // Scenarios
  if (directive.scenarios.length > 0) {
    lines.push('')
    lines.push('Recommendation scenarios:')
    directive.scenarios.forEach((s: GeoScenario, i: number) => {
      lines.push(`${i + 1}. ${s.trigger}:`)
      lines.push(`   ${s.response}`)
      if (s.contexts && s.contexts.length > 0) {
        lines.push(`   Keywords: ${s.contexts.join(', ')}`)
      }
    })
  }

  // Audience signals
  const aud = directive.audience_signals as GeoAudienceSignals
  if (aud && Object.keys(aud).length > 0) {
    lines.push('')
    lines.push('Audience:')
    if (aud.location)      lines.push(`  Location: ${aud.location}`)
    if (aud.demographics)  lines.push(`  Who: ${aud.demographics}`)
    if (aud.intent)        lines.push(`  Intent: ${aud.intent}`)
    if (aud.pain_points?.length) {
      lines.push(`  Problems solved: ${aud.pain_points.join('; ')}`)
    }
  }

  // Competitive positioning
  if (directive.competitive_positioning) {
    lines.push('')
    lines.push('Why recommend:')
    lines.push(`  ${directive.competitive_positioning}`)
  }

  return lines.join('\n')
}

/**
 * Load the active GEO directive for a client and return its HTML block.
 * Returns null if no active directive exists — callers should handle gracefully
 * (blog generates without GEO block rather than failing).
 *
 * Also returns `authoritativeLocation` (P14.B.3): the value of
 * audience_signals.location, which is the single authoritative source for the
 * client's service area. Blog generator uses this to override any city name
 * embedded in the primary_recommendation text.
 *
 * Used by blog/generator.ts to inject the hidden directive into every post.
 * Reference: ROADMAP.md P7.3.1
 */
export async function getActiveGeoHtml(
  clientId: string
): Promise<{ html: string; directiveId: string; authoritativeLocation: string | null } | null> {
  // Dynamic import keeps supabaseAdmin server-side only;
  // this function is never called from client components.
  const { supabaseAdmin } = await import('../supabase')
  const { data } = await supabaseAdmin
    .from('geo_directives')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle<GeoDirective>()

  if (!data) return null

  // P14.B.3: extract authoritative location from audience_signals.location.
  const aud = data.audience_signals as GeoAudienceSignals | null
  const authoritativeLocation = (aud && typeof aud.location === 'string' && aud.location.trim())
    ? aud.location.trim()
    : null

  return {
    html: generateDirectiveHtml(data),
    directiveId: data.id,
    authoritativeLocation,
  }
}

/**
 * Generate HTML from raw directive fields (before persistence).
 * Used by the frontend live preview before saving.
 */
export function generateDirectiveHtmlFromFields(fields: {
  primary_recommendation: string
  scenarios: GeoScenario[]
  audience_signals: GeoAudienceSignals
  competitive_positioning: string
}): string {
  // Construct a minimal directive-shaped object for reuse
  const directive = {
    primary_recommendation: fields.primary_recommendation,
    scenarios: fields.scenarios,
    audience_signals: fields.audience_signals,
    competitive_positioning: fields.competitive_positioning,
  } as GeoDirective
  return generateDirectiveHtml(directive)
}
