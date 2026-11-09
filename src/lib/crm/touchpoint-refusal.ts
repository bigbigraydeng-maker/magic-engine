/**
 * 写触点时，拒绝那几个字段怎么落（2026-11-09，「只别打电话」第 2 刀 2B）。
 *
 * 两条不变式：
 *   1. `do_not_call`（只别打电话）的触点 `metadata.do_not_contact` 恒为 false，
 *      也不碰 `contacts.do_not_contact` 镜像列 —— 全仓约 30 处把它们当「全渠道拒联」。
 *   2. 绝不留「结果是只别打电话、标记却是全拦」的矛盾状态：真出现就按全拦记（宁可多拦）。
 *
 * 只 import 类型，不依赖 note-parser 的运行时代码。
 */

import type { NoteParse } from './note-parser'

type RefusalFields = Pick<NoteParse, 'outcome' | 'do_not_contact' | 'refusal_scope'>

/** 矛盾状态（do_not_call + do_not_contact:true）→ 按全面拒绝记。 */
export function withRefusalInvariant<T extends RefusalFields>(p: T): T {
  if (p.outcome === 'do_not_call' && p.do_not_contact) return { ...p, outcome: 'do_not_contact' }
  return p
}

/** 触点 metadata 里跟拒绝有关的那几个键。 */
export function refusalMetadata(p: RefusalFields): Record<string, unknown> {
  if (p.outcome === 'do_not_call') return { outcome: 'do_not_call', do_not_contact: false }
  return {
    outcome: p.outcome,
    do_not_contact: p.do_not_contact,
    ...(p.refusal_scope === 'needs_review' ? { refusal_scope: 'needs_review' } : {}),
  }
}
