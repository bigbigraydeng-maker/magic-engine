import { NextRequest, NextResponse } from 'next/server'
import { getAdapter } from '@/lib/flywheel/adapters/registry'
import type { ExecuteActionInput, FlywheelName } from '@/lib/flywheel/adapters/types'

// Side-effect imports register adapters into the singleton registry.
import '@/lib/flywheel/adapters/GeoComposerAdapter'
import '@/lib/flywheel/adapters/SeoContentAdapter'
import '@/lib/flywheel/adapters/SocialContentAdapter'
import '@/lib/flywheel/adapters/MetaAdsAdapter'

interface RequestBody extends ExecuteActionInput {
  flywheel: FlywheelName
}

/**
 * POST /api/flywheel/execute
 *
 * Dispatches a flywheel action to the appropriate adapter and writes a row
 * to flywheel_actions.  Returns the created FlywheelActionRow.
 *
 * Body: { flywheel, clientId, actionType, executionMode, [executionItemId],
 *         [vendor], [payload], [expectedMetric], [expectedDelta] }
 */
export async function POST(req: NextRequest) {
  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { flywheel, clientId, actionType, executionMode } = body

  if (!flywheel || !clientId || !actionType || !executionMode) {
    return NextResponse.json(
      { error: 'Missing required fields: flywheel, clientId, actionType, executionMode' },
      { status: 400 }
    )
  }

  try {
    const adapter = getAdapter(flywheel)
    const result = await adapter.execute({
      clientId:             body.clientId,
      executionItemId:      body.executionItemId,
      actionType:           body.actionType,
      executionMode:        body.executionMode,
      vendor:               body.vendor,
      payload:              body.payload,
      expectedMetric:       body.expectedMetric,
      expectedDelta:        body.expectedDelta,
      productionPackageId:  body.productionPackageId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
