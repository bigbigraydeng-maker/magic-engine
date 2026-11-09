/** Plain-Chinese messages for the document library page. */

export const GENERIC_ACTION_ERROR = '操作没成功，请稍后再试'

export interface ApiFailure {
  status: number
  error: string | null
  code: string | null
}

export async function readFailure(res: Response): Promise<ApiFailure> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  return {
    status: res.status,
    error: typeof record.error === 'string' ? record.error : null,
    code: typeof record.code === 'string' ? record.code : null,
  }
}

/** What to show in place of the whole library when the list cannot be loaded. */
export function blockedText(failure: ApiFailure): string {
  if (failure.status === 401) return '登录已过期，请刷新页面重新登录'
  if (failure.status === 402 || failure.status === 403) return '你的账号还没有开通资料库。需要使用请联系 Magic Lab 团队。'
  if (failure.status === 404) return '找不到这个客户。'
  if (failure.code === 'client_documents_unavailable') return '资料库暂时不可用，Magic Lab 团队正在处理。'
  return '资料库暂时打不开，请稍后再试。'
}

/** What to show next to a failed upload / edit: the server's own sentence when it sent one. */
export function actionText(failure: ApiFailure): string {
  return failure.error ?? GENERIC_ACTION_ERROR
}
