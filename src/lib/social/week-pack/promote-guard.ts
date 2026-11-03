/**
 * Last gate in front of Reel go-public. The page switch and this guard must both be on,
 * and the person must be a global administrator. Otherwise the promote function is not called.
 */

import { isGlobalAdminEmail } from '@/lib/auth/whitelist'

import type { ReelPromoteResult } from './lines'

export async function promoteReelGated(input: {
  enabled: boolean
  allowedClientId: string | null
  email: string
  run: () => Promise<ReelPromoteResult>
}): Promise<ReelPromoteResult> {
  if (!input.enabled) {
    return {
      ok: true,
      code: 'skipped_switch_off',
      text: '视频不在这里转公开，请仍在视频工厂逐条处理。',
    }
  }
  if (input.allowedClientId !== null || !isGlobalAdminEmail(input.email)) {
    return {
      ok: false,
      code: 'reel_forbidden',
      text: '转公开仍要全局管理员。这条没公开，其他条不撤回。',
    }
  }
  return input.run()
}
