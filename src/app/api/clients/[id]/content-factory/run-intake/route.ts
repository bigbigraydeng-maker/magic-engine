import { NextRequest, NextResponse } from 'next/server'
import { runIntakeForClient } from '@/lib/content-factory/intake-runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // Apify 抓取 + 多次 Claude 改写，给满

// POST /api/clients/[id]/content-factory/run-intake
// 手动跑一次进料：读配置 → Apify 抓小红书/抖音 → 选题助理改写 → 写 content_posts。
// cron 也调这条逻辑(runIntakeForClient)。
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const result = await runIntakeForClient(params.id)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
