/**
 * 「读数据适配器」：页面只通过它拿数据。
 *
 * 现在有三个实现：
 *  - 真实数据（./http-adapter.ts，由 createLiveAdapter 返回）：调读接口 /api/clients/[id]/crm/auto-letters。
 *  - 示例（./demo-data.ts）：合成假数据，页面整页标明「示例数据」，给测试和预览用。
 *  - 「还没接通」（AutoSendNotConnectedError）：数据来源暂时没有时适配器抛它，页面显示空状态 + 「看示例」。
 *
 * 只读：这里没有任何写、发、放行的方法，也不应该有。
 */

import { createHttpAdapter } from './http-adapter'
import type { AutoSendOverview, LetterDetail } from './types'

export interface AutoSendAdapter {
  loadOverview(): Promise<AutoSendOverview>
  loadLetterDetail(letterId: string): Promise<LetterDetail>
}

/** 数据来源还没接通（不是读失败）：页面显示「还没接通」，不显示红色错误。 */
export class AutoSendNotConnectedError extends Error {
  constructor() {
    super('auto-send data source is not connected yet')
    this.name = 'AutoSendNotConnectedError'
  }
}

export function isNotConnectedError(err: unknown): boolean {
  return err instanceof AutoSendNotConnectedError
}

/**
 * 读失败时给人看的那句话。只有本身就是中文句子的错误信息才原样显示；
 * 其余（浏览器的英文报错、堆栈等）一律说「网络出错」，不把技术字眼摆给 PM 看。
 */
export function loadErrorText(err: unknown): string {
  if (err instanceof Error && /[一-鿿]/.test(err.message)) return err.message
  return '网络出错'
}

/** 真实数据的适配器：调读接口。 */
export function createLiveAdapter(clientId: string): AutoSendAdapter {
  return createHttpAdapter(clientId)
}
