import { createHash } from 'node:crypto'
import { stableStringify } from '../plan-guard'
import type { PromoSpec } from './spec'

/**
 * 推广结构的内容指纹：同样的内容永远同一个值，改了任何一处金额 / 受众 / 素材 / 日期 / 目标就变。
 * 序列化复用 plan-guard 的 stableStringify（键排序、数组保序），和「推广结构是否被改动」用同一把尺。
 * 剔除 checks（客户端可写、保存时被清空、判定不参与）与 gate_snapshot（服务端留底，不属于被批准的内容）。
 */
export function promoContentHash(spec: PromoSpec): string {
  // 用 Object.entries 过滤，避免解构出未使用变量触发 lint 报错。
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(spec)) {
    if (key === 'checks' || key === 'gate_snapshot') continue
    content[key] = value
  }
  return createHash('sha256').update(stableStringify(content)).digest('hex').slice(0, 16)
}
