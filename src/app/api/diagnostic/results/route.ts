import { retiredDiagnosticResponse } from '@/lib/diagnostic/retired'

export const dynamic = 'force-dynamic'

export function GET() {
  return retiredDiagnosticResponse()
}
