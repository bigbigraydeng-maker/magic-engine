import { getOpenAIClient } from '@/lib/ai/openai-client'

export type PageType = 'landing' | 'product' | 'service' | 'blog' | 'contact' | 'about' | 'other'

export interface ClassificationResult {
  page_type: PageType
  topics: string[]
  primary_keyword: string | null
  confidence: number
}

export interface ClassifyOptions {
  temperature?: number
}

export async function classifyPage(
  url: string,
  title: string,
  markdown: string,
  opts?: ClassifyOptions
): Promise<ClassificationResult> {
  if (!url || url.trim().length === 0) {
    throw new Error('URL is required')
  }
  if (!title || title.trim().length === 0) {
    throw new Error('Title is required')
  }
  if (!markdown || markdown.trim().length === 0) {
    throw new Error('Markdown content is required')
  }

  // Truncate markdown to first 3000 chars to avoid token limits
  const truncatedMarkdown = markdown.slice(0, 3000)

  const openai = getOpenAIClient()

  const systemPrompt = `You are a page classifier for website content analysis. Classify pages into categories and extract key metadata.

Respond ONLY with valid JSON, no markdown formatting or extra text:
{
  "page_type": "landing|product|service|blog|contact|about|other",
  "topics": ["topic1", "topic2", "topic3"],
  "primary_keyword": "keyword or null",
  "confidence": 0.0-1.0
}

page_type rules:
- "landing": Homepage or main entry point
- "product": Product showcase/description page
- "service": Service offering page
- "blog": Article or blog post
- "contact": Contact form or contact info page
- "about": About us, company info, team page
- "other": Does not fit above categories

topics: Extract 2-5 main topics/themes from the page content
primary_keyword: The main SEO keyword or topic this page targets, or null if unclear
confidence: 0.7-1.0 based on how clearly the page fits its classification`

  const userMessage = `Classify this page:

URL: ${url}
Title: ${title}

Content (first 3000 chars):
${truncatedMarkdown}`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: opts?.temperature ?? 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    const content = response.choices[0].message.content ?? '{}'

    // Parse JSON, handling potential markdown code blocks
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned) as ClassificationResult

    // Validate parsed result
    if (!parsed.page_type || !Array.isArray(parsed.topics) || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid classification response structure')
    }

    // Ensure topics is string array
    const validTopics = parsed.topics.filter((t): t is string => typeof t === 'string' && t.length > 0)

    return {
      page_type: parsed.page_type,
      topics: validTopics.slice(0, 5), // Cap at 5 topics
      primary_keyword: parsed.primary_keyword ?? null,
      confidence: Math.min(Math.max(parsed.confidence, 0), 1),
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse OpenAI response as JSON: ${err.message}`)
    }
    throw err
  }
}

export async function classifyPages(
  pages: Array<{ url: string; title: string; markdown: string }>,
  opts?: ClassifyOptions
): Promise<Map<string, ClassificationResult>> {
  const results = new Map<string, ClassificationResult>()

  for (const page of pages) {
    try {
      const result = await classifyPage(page.url, page.title, page.markdown, opts)
      results.set(page.url, result)
    } catch (err) {
      console.error(`[classifier] Failed to classify ${page.url}:`, err)
      // Store error result
      results.set(page.url, {
        page_type: 'other',
        topics: [],
        primary_keyword: null,
        confidence: 0,
      })
    }
  }

  return results
}
