/**
 * Client Knowledge Base — failure vocabulary.
 *
 * 🔴 Both read paths (`getClientKnowledge`, `getKnowledgeEntitlement`) must
 * throw on failure, never return an empty result — an empty array/object is
 * indistinguishable from "this client genuinely has no facts yet", and an AI
 * reading that will start inventing answers from training knowledge. That is
 * the exact accident this whole capability exists to prevent. See Issue
 * #1644 §"读失败必须抛错".
 */

export class KnowledgeReadError extends Error {
  constructor(op: string, cause: { message?: string } | null) {
    super(`[knowledge] ${op} 失败：${cause?.message ?? '未知错误'}`)
    this.name = 'KnowledgeReadError'
  }
}

/**
 * Thrown by `getClientKnowledge` when the client has no live entitlement
 * grant. Distinct from `KnowledgeReadError` (a DB/infra failure) so callers
 * can tell "you're not allowed to read this" apart from "the read broke" —
 * but both are exceptions, neither is a silently-empty result.
 */
export class KnowledgeNotEntitledError extends Error {
  constructor(clientId: string) {
    super(`[knowledge] client ${clientId} 没有客户知识库的有效授权（entitlement）—— fail-closed 拒绝读取`)
    this.name = 'KnowledgeNotEntitledError'
  }
}
