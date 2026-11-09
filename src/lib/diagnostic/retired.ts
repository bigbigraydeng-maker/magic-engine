import { NextResponse } from 'next/server'

/** Huatuo six-dimension scoring is retired. Callers get 410 and no scores. */
export const DIAGNOSTIC_RETIRED_ERROR = '华佗六维体检诊断已废弃'

export function retiredDiagnosticResponse(): NextResponse {
  return NextResponse.json(
    { retired: true, error: DIAGNOSTIC_RETIRED_ERROR },
    { status: 410 },
  )
}
