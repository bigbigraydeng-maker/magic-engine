/**
 * 「读数据适配器」：页面只通过它拿数据。
 *
 * 现在有两个实现：
 *  - 还没接通（本文件）：真实数据接口还没来，永远报「还没接通」，页面据此显示空状态 + 「看示例」。
 *  - 示例（./demo-data.ts）：合成假数据，只在员工点「看示例」时用，页面整页标明「示例数据」。
 * 真实数据接口来了，再加第三个实现（调它的读接口），页面不用改。
 *
 * 只读：这里没有任何写、发、放行的方法，也不应该有。
 */

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

/** 真实数据的适配器。接口来之前它只会报「还没接通」。 */
export function createLiveAdapter(_clientId: string): AutoSendAdapter {
  return {
    loadOverview: () => Promise.reject(new AutoSendNotConnectedError()),
    loadLetterDetail: () => Promise.reject(new AutoSendNotConnectedError()),
  }
}
