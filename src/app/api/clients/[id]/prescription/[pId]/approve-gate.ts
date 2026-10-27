/**
 * Approve-only gate for PATCH /api/clients/[id]/prescription/[pId].
 *
 * A prescription can be approved only while it is still a draft and its
 * content has something to approve. Reject uses a different path and must
 * not call this.
 *
 * Empty means there is nothing to read: null, a blank string, or a container
 * whose every nested value is empty. A stored number or boolean counts as
 * content, so a target of 0 is not treated as a blank draft.
 */

export type ApproveGateResult =
  | { ok: true }
  | { ok: false; httpStatus: 409 | 422; error: string }

const EMPTY_CONTENT_ERROR = '处方内容为空，不能同意'

export function isPrescriptionContentEmpty(content: unknown): boolean {
  if (typeof content === 'string') return content.trim() === ''
  if (typeof content === 'number' || typeof content === 'boolean') return false
  if (Array.isArray(content)) return content.every(isPrescriptionContentEmpty)
  if (content !== null && typeof content === 'object') {
    const values = Object.values(content as Record<string, unknown>)
    return values.every(isPrescriptionContentEmpty)
  }
  return true
}

export function approveDraftContentGate(
  status: string,
  content: unknown,
): ApproveGateResult {
  if (status !== 'draft') {
    return {
      ok: false,
      httpStatus: 409,
      error: `只能同意草稿状态的处方，当前状态是 ${status}`,
    }
  }
  if (isPrescriptionContentEmpty(content)) {
    return { ok: false, httpStatus: 422, error: EMPTY_CONTENT_ERROR }
  }
  return { ok: true }
}
