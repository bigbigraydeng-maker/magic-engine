/**
 * Generates Facebook image-post copy (hook / body / CTA) strictly grounded
 * in tour-catalog facts.  Uses GPT-4o-mini via the existing Content Engine
 * wrapper — the prompt is designed so nothing outside the catalog leaks in.
 */
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import type { RankableAssetRow } from '@/lib/factory/client-asset-pool'

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(tour: PublishedTourFact, _asset: RankableAssetRow): string {
  const facts = [
    `Tour name: ${tour.name}`,
    `Destination: ${tour.destination}`,
    tour.durationText ? `Duration: ${tour.durationText}` : null,
    tour.displayPriceText ? `Price: ${tour.displayPriceText}` : null,
    tour.highlights.length > 0 ? `Highlights: ${tour.highlights.join(', ')}` : null,
    tour.inclusions.length > 0 ? `Inclusions: ${tour.inclusions.join(', ')}` : null,
    tour.singleSupplement ? `Single supplement: ${tour.singleSupplement}` : null,
    tour.departures.length > 0
      ? `Next departures: ${tour.departures.slice(0, 3).map((d) => d.displayDate).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  return `You are a travel social-media copywriter for CTS Tours NZ.
Write a short Facebook image post about the tour below.

RULES — break any of these and the post will be rejected:
- Use ONLY the facts provided. Do NOT invent prices, durations, hotels, or inclusions.
- Hook: 1 sentence, max 15 words, attention-grabbing.
- Body: 2–3 sentences, max 80 words, highlight what makes this tour special.
- CTA: 1 sentence, max 12 words, e.g. "Explore the full itinerary on our website."
- Do NOT use emojis.
- Write in Australian/NZ English.
- Do NOT mention visa, insurance, weather, or flight details unless listed below.

TOUR FACTS:
${facts}

Respond in exactly this JSON format, no markdown:
{"hook":"...","body":"...","cta":"..."}`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateCopyDeps {
  callLLM: (prompt: string) => Promise<string>
}

export interface CopyResult {
  hook: string
  body: string
  cta: string
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generateImagePostCopy(
  tour: PublishedTourFact,
  asset: RankableAssetRow,
  deps: GenerateCopyDeps,
): Promise<CopyResult> {
  const prompt = buildPrompt(tour, asset)
  const raw = await deps.callLLM(prompt)

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('LLM response is not valid JSON')

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  const hook = typeof parsed.hook === 'string' ? parsed.hook.trim() : ''
  const body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
  const cta = typeof parsed.cta === 'string' ? parsed.cta.trim() : ''

  if (!hook || !body || !cta) throw new Error('LLM returned empty copy fields')

  return { hook, body, cta }
}
