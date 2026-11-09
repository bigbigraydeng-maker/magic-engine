import { NextResponse } from 'next/server'

/** Small JSON error helpers shared by the three document routes. */

export function jsonError(status: number, error: string, code?: string): NextResponse {
  return NextResponse.json(code ? { error, code } : { error }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export function unavailable(): NextResponse {
  return jsonError(500, '资料库暂不可用，请确认数据库迁移已安装', 'client_documents_unavailable')
}

export function notFound(what = '文件'): NextResponse {
  return jsonError(404, `${what}不存在`)
}
