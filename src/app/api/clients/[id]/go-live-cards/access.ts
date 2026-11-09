import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { clickerFromSession, type CardClicker } from '@/lib/confirmation-card'
import { isUuid } from '@/lib/validation-utils'

type AccessOk = Awaited<ReturnType<typeof requirePaidClientAccess>> & { ok: true }

export async function openReader(req: Request, clientId: string): Promise<
  { access: AccessOk; clicker: CardClicker } | { error: string; status: number }
> {
  if (!isUuid(clientId)) return { error: '这个地址不对。', status: 400 }
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    const message = access.status === 401 ? '请先登录。' : '你不能看这位客户的广告。'
    return { error: message, status: access.status }
  }
  return {
    access,
    clicker: clickerFromSession({
      email: access.user.email ?? '',
      role: access.role,
      allowedClientId: access.allowedClientId,
      clientId,
      agentMarked: req.headers.get('x-me-actor') === 'agent',
    }),
  }
}
