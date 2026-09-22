import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { compareTours, validateTourComparison } from '@/lib/web-intelligence/tour-comparison'

const recordSchema = z.object({
  name: z.string().trim().max(240).optional(), durationDays: z.number().finite().positive().max(365).optional(), duration_days: z.number().finite().positive().max(365).optional(),
  price: z.string().trim().max(120).optional(), promotion: z.string().trim().max(240).optional(), route: z.string().trim().max(1000).optional(),
  departureWindow: z.string().trim().max(240).optional(), departure_window: z.string().trim().max(240).optional(), includes: z.string().trim().max(1000).optional(),
  positioning: z.string().trim().max(500).optional(), audience: z.string().trim().max(500).optional(), itinerary: z.array(z.string().trim().max(500)).max(60).optional(),
}).strict()
const bodySchema = z.object({
  market_scope: z.array(z.string().trim().min(1).max(80)).max(10),
  client_product: z.object({ name: z.string().trim().min(1).max(240), source_url: z.string().url().max(2048).nullable().optional(), record: recordSchema }).strict(),
  competitor_product: z.object({ name: z.string().trim().min(1).max(240), source_url: z.string().url().max(2048), observed_at: z.string().datetime({ offset: true }).nullable(), record: recordSchema }).strict(),
}).strict()

type Context = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const input = bodySchema.parse(await req.json())
    const result = await compareTours(input)
    const comparison = validateTourComparison(result.text, input)
    return NextResponse.json({ comparison, model: 'claude-haiku-4-5-20251001', cost_usd: result.cost_usd, prompt_version: 'tour-comparison-v1' })
  } catch (error) {
    const message = error instanceof Error && error.message === 'invented_tour_comparison_source' ? 'AI 对比引用了未提供的来源。' : '暂时无法生成 Tour 对比，请稍后重试。'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
