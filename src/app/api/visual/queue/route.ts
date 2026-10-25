import { NextRequest, NextResponse } from 'next/server'
import { GENERATION_CONFIG } from '@/lib/visual/generation-config'
import { requireSession } from '@/lib/auth/require-session'

/**
 * GET /api/visual/queue
 * Returns queue configuration and status information.
 * Primarily for debugging and future server-side queue management.
 */
export async function GET(_req: NextRequest) {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({
      success: true,
      message: 'Generation queue service ready',
      config: {
        max_concurrent_generations: GENERATION_CONFIG.MAX_CONCURRENT_GENERATIONS,
        polling_interval_ms: GENERATION_CONFIG.POLLING_INTERVAL_MS,
        timeout_ms: GENERATION_CONFIG.POLLING_TIMEOUT_MS,
        warning_timeout_ms: GENERATION_CONFIG.WARNING_TIMEOUT_MS,
        max_auto_retries: GENERATION_CONFIG.MAX_AUTO_RETRIES,
        retry_delays_ms: GENERATION_CONFIG.RETRY_DELAYS_MS,
      },
      status: 'operational',
      queue_location: 'client-side (localStorage)',
      note: 'Queue is currently managed on the client. Server-side queue management can be implemented in the future.',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual/queue]', err)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
