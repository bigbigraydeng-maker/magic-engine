/**
 * 台账落库口的假件。
 *
 * 🔴 按**契约**建模，不按调用次序建模：`writeAcceptedPages` 返回的是「实际写进去的清单」，
 *    所以假件必须能表达「少写了一条」「多写了一条」「写到一半炸了」这几种真实结局 ——
 *    只会返回入参回声的假件，会让「写入集合精确对账」那道闸恒绿。
 */

import type { AcceptedPageRecord, CanonicalInventoryStore } from '../types'

export interface FakeStoreOptions {
  /** 当前台账行数。 */
  readonly existingCount?: number
  /**
   * 第 N 次 `countExistingPages` 返回的值（1 起）。用来造「抓取期间别人往里写了」——
   * 第一次读到 0、写之前那次读到非 0。没配到的次数回落到 `existingCount`。
   */
  readonly countSequence?: readonly number[]
  /** 让 `countExistingPages` 抛错（模拟读不到，而不是读到 0）。 */
  readonly countError?: string
  /** 让 `writeAcceptedPages` 抛错。 */
  readonly writeError?: string
  /** 写入返回值的改写钩子 —— 用来造「少写 / 多写」。默认原样返回全部 canonical URL。 */
  readonly writeResult?: (pages: readonly AcceptedPageRecord[]) => readonly string[]
}

export class FakeInventoryStore implements CanonicalInventoryStore {
  readonly writes: { clientId: string; pages: readonly AcceptedPageRecord[] }[] = []
  /** 每次写入时传进来的「必须仍为空」标记 —— 契约要求实现方在事务里重新确认。 */
  readonly requireEmptyFlags: boolean[] = []
  countCalls = 0

  constructor(private readonly options: FakeStoreOptions = {}) {}

  async countExistingPages(clientId: string): Promise<number> {
    this.countCalls++
    if (this.options.countError !== undefined) {
      throw new Error(`${this.options.countError} (client=${clientId})`)
    }
    const seq = this.options.countSequence
    if (seq !== undefined && this.countCalls <= seq.length) return seq[this.countCalls - 1]
    return this.options.existingCount ?? 0
  }

  async writeAcceptedPages(input: {
    clientId: string
    pages: readonly AcceptedPageRecord[]
    requireEmptyInventory: boolean
  }): Promise<readonly string[]> {
    this.writes.push({ clientId: input.clientId, pages: input.pages })
    this.requireEmptyFlags.push(input.requireEmptyInventory)
    if (this.options.writeError !== undefined) throw new Error(this.options.writeError)
    const shape = this.options.writeResult
    return shape ? shape(input.pages) : input.pages.map((p) => p.canonicalUrl)
  }

  /** 到达过持久化的所有 canonical URL —— 用来断言「被拒/暂缓的一条都没到这里」。 */
  allWrittenUrls(): string[] {
    return this.writes.flatMap((w) => w.pages.map((p) => p.canonicalUrl))
  }
}
