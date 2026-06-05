import { NextRequest, NextResponse } from 'next/server'
import { MonthlyReportAggregator } from '@/lib/monthly-report/aggregator'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const clientId = params.id
    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month')

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        {
          success: false,
          errors: [
            {
              datasource: 'validation',
              error: 'Invalid month format. Use YYYY-MM',
            },
          ],
        },
        { status: 400 }
      )
    }

    if (!clientId) {
      return NextResponse.json(
        {
          success: false,
          errors: [
            {
              datasource: 'validation',
              error: 'Client ID is required',
            },
          ],
        },
        { status: 400 }
      )
    }

    const aggregator = new MonthlyReportAggregator()
    const response = await aggregator.generateReport(clientId, month)

    return NextResponse.json(response, {
      status: response.success ? 200 : 206,
    })
  } catch (error) {
    console.error('Monthly report generation error:', error)

    return NextResponse.json(
      {
        success: false,
        errors: [
          {
            datasource: 'system',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        ],
      },
      { status: 500 }
    )
  }
}
