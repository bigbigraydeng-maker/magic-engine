/**
 * POST /api/admin/viral-references/detect-industry-batch
 *
 * Re-detects industry for existing analyzed videos that have no detected_industry.
 * Uses text-only GPT-4o-mini — no video re-download needed.
 * Processes up to 50 records per call, batched 10 at a time in parallel.
 */
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { supabaseAdmin } from '@/lib/supabase'

const KNOWN_INDUSTRIES = [
  'travel', 'flooring', 'real_estate', 'food', 'fashion',
  'fitness', 'tech', 'beauty', 'home_improvement', 'finance',
]

async function inferIndustry(
  client: OpenAI,
  record: {
    video_title: string | null
    channel_title: string | null
    style_description: string | null
    style_tags: string[] | null
    key_techniques: string[] | null
  }
): Promise<string> {
  const lines: string[] = []
  if (record.video_title)     lines.push(`Title: ${record.video_title}`)
  if (record.channel_title)   lines.push(`Channel: ${record.channel_title}`)
  if (record.style_description) lines.push(`Description: ${record.style_description}`)
  if (record.style_tags?.length)      lines.push(`Tags: ${record.style_tags.join(', ')}`)
  if (record.key_techniques?.length)  lines.push(`Techniques: ${record.key_techniques.join(', ')}`)

  if (lines.length === 0) return 'unknown'

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 20,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You classify marketing videos into industries. Reply with ONLY one lowercase word from this list: ${KNOWN_INDUSTRIES.join(', ')}. If none fit, use the closest match.`,
      },
      {
        role: 'user',
        content: lines.join('\n'),
      },
    ],
  })

  const raw = (res.choices[0]?.message?.content ?? '').toLowerCase().trim().replace(/[^a-z_]/g, '')
  return raw || 'unknown'
}

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'OPENAI_API_KEY not configured' }, { status: 500 })
  }

  const { data: records, error } = await supabaseAdmin
    .from('viral_reference_library')
    .select('id, video_title, channel_title, style_description, style_tags, key_techniques')
    .eq('analysis_status', 'done')
    .is('detected_industry', null)
    .limit(50)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  if (!records || records.length === 0) {
    return NextResponse.json({ success: true, updated: 0, message: 'All records already have detected_industry' })
  }

  const client = new OpenAI({ apiKey })

  // Process in batches of 10 in parallel
  const BATCH = 10
  let updated = 0
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async r => ({
        id: r.id,
        industry: await inferIndustry(client, r).catch(() => 'unknown'),
      }))
    )

    for (const { id, industry } of results) {
      if (industry && industry !== 'unknown') {
        await supabaseAdmin
          .from('viral_reference_library')
          .update({ detected_industry: industry })
          .eq('id', id)
        updated++
      }
    }
  }

  return NextResponse.json({
    success: true,
    updated,
    remaining: records.length - updated,
    message: `${updated} / ${records.length} records updated`,
  })
}
