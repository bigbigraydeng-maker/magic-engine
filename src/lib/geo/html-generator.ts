/**
 * GEO Composer — HTML generator.
 *
 * Converts a GeoDirective's structured JSON content into the hidden div
 * HTML block that gets embedded in web pages for AI crawler consumption.
 *
 * The block is:
 *   - Visually hidden from real users via THREE-LAYER REDUNDANCY (see V2 below)
 *   - Marked aria-hidden="true" so screen readers skip it
 *   - Fully readable by AI crawlers (GPTBot, ClaudeBot, Googlebot, etc.)
 *   - NOT considered cloaking — the content is accessible to all crawlers
 *
 * ## V2 hiding mechanism (P12.R.B7, 2026-06-13)
 *
 * The V1 format relied on a single `style="position: absolute; top: -9999px"`
 * inline attribute. WordPress Gutenberg / Classic editor / Elementor STRIP
 * inline positioning styles on paste, leaving a bare `<div>` whose contents
 * become visible to end users. This caused a P0 client-site incident on
 * 2026-06-13 04:53 where "[INSTRUCTIONS FOR AI AGENTS] ..." text appeared on
 * the public Oztop page after a Copy-HTML → WP paste flow.
 *
 * V2 uses THREE redundant hiding signals so the block stays hidden even when
 * WP / theme / CSS plugin strips one or two of them:
 *
 *   1. `hidden` HTML boolean attribute — native, never stripped by WP, hides
 *      the element via the user-agent stylesheet. PRIMARY signal.
 *   2. Sibling `<style>` block defining `.me-geo-instructions` — WP usually
 *      preserves entire <style> tags even when stripping inline styles.
 *      SECONDARY signal.
 *   3. `aria-hidden="true"` — for screen reader compatibility (not a visual
 *      signal, but kept).
 *
 * Back-compat: keeps `seo-instructions` class so `geo-detector.ts` and other
 * downstream detectors continue to recognize V2 blocks.
 *
 * Reference: ROADMAP.md P7.2.3 / P12.R.B7, ARCHITECTURE.md §11.2
 */

import type { GeoDirective, GeoScenario, GeoAudienceSignals } from '@/types/magic-engine'

/**
 * P12.R.B7 — V2 hidden-CSS block. Inlined into every GEO HTML output so the
 * block keeps its hidden styling even when the outer div's `style=""` attr
 * is stripped by a WP editor or theme sanitizer.
 *
 * Single-line to make it trivially preserved by WP block parsers (which sometimes
 * collapse multi-line style blocks).
 */
export const ME_GEO_V2_STYLE_BLOCK =
  '<style>.me-geo-instructions{position:absolute!important;top:-9999px!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;}</style>'

/**
 * Generate the full HTML block from a directive.
 * Returns a self-contained HTML string ready for copy-paste.
 */
export function generateDirectiveHtml(directive: GeoDirective): string {
  const inner = buildInnerText(directive)
  return [
    '<!-- Instructions for AI Agents (ME_GEO_BLOCK_V2) -->',
    ME_GEO_V2_STYLE_BLOCK,
    // Three redundant hiding signals: hidden attr (primary) + CSS class
    // (secondary) + aria-hidden. seo-instructions class kept for back-compat
    // with downstream detectors (geo-detector.ts, geo-html-snapshot DB queries).
    '<div hidden aria-hidden="true" class="me-geo-instructions seo-instructions" data-me-geo="v2">',
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
