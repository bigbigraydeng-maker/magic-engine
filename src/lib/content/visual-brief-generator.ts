/**
 * Generates a Flux-dev–ready image generation prompt from post content + MB visual DNA.
 *
 * Runs as a second step after text content is generated, so the visual prompt
 * is grounded in both the specific post copy AND the brand's visual guidelines.
 */

import OpenAI from 'openai'
import type { MasterBrief } from '@/types/magic-engine'

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

function extractVisualDna(brief: MasterBrief): string {
  const styleKeywords = brief.vi_style_keywords?.join(', ')
    || brief.visual_style
    || ''

  const brandColors = (() => {
    if (brief.vi_colors) {
      const { primary, secondary, accent } = brief.vi_colors as Record<string, string>
      return [primary, secondary, accent].filter(Boolean).join(', ')
    }
    return brief.color_palette?.join(', ') || ''
  })()

  const avoid = brief.vi_donts?.join(', ') || brief.image_preference || ''

  const parts: string[] = []
  if (styleKeywords) parts.push(`Visual style: ${styleKeywords}`)
  if (brandColors) parts.push(`Brand colors: ${brandColors}`)
  if (avoid) parts.push(`Avoid in visuals: ${avoid}`)

  return parts.join('\n')
}

export interface VisualBriefInput {
  postTitle: string
  postScript: string
  postCaption: string
  brief: MasterBrief
  platforms: string[]
  topic: string
}

/**
 * Returns a Flux-dev image generation prompt (60-120 words) grounded in
 * the post content and MB visual DNA. Falls back to a basic prompt on error.
 */
export async function generateVisualBrief(input: VisualBriefInput): Promise<string> {
  const { postTitle, postScript, postCaption, brief, platforms, topic } = input

  const visualDna = extractVisualDna(brief)
  const brandName = brief.brand_name ?? 'the brand'

  const systemPrompt = `You are an expert AI image prompt engineer for Flux-dev (photorealistic diffusion model).
Generate a single image generation prompt that:
1. Captures the essence of the social media post content
2. Strictly follows the brand's visual DNA
3. Is suitable for ${platforms.join(' and ')} format
4. Is 60-120 words, highly descriptive, photorealistic style language
5. Never mentions text overlays or logos (those are added separately)

Output ONLY the prompt text — no explanation, no quotes, no JSON.`

  const userMessage = `POST TITLE: ${postTitle}
POST CONTENT SUMMARY: ${postScript.slice(0, 300)}
POST CAPTION: ${postCaption.slice(0, 150)}
TOPIC: ${topic}
BRAND: ${brandName}

VISUAL DNA:
${visualDna || 'No specific visual DNA provided — infer from brand and post content'}

Generate the Flux-dev image prompt now.`

  try {
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })
    return completion.choices[0].message.content?.trim() ?? fallbackPrompt(topic, brandName)
  } catch {
    return fallbackPrompt(topic, brandName)
  }
}

function fallbackPrompt(topic: string, brandName: string): string {
  return `Professional lifestyle photograph related to ${topic} for ${brandName}, clean composition, natural lighting, warm tones, high resolution`
}
