/**
 * Stable sampling for the C-level review lane.
 *
 * C-level PRs (docs, styling, images, test-only) do not each need a Codex
 * review — paying for one on every push is what turned a six-file docs PR into
 * three full automated fix rounds (#1204, 2026-08-27). But sampling *none* of
 * them means a mis-rated change never gets a second pair of eyes, so a fixed
 * fraction is still reviewed.
 *
 * 🔴 **Why the sample must be stable, not random.**
 *
 * The decision is re-evaluated on every workflow run, and a run can be
 * re-delivered, retried, or raced by a duplicate event. With `Math.random()`
 * the same head sha could be "not sampled" on one delivery and "sampled" on the
 * next — which posts a second `@codex review`, restarts the loop, and makes the
 * dedup markers describe a PR that changed its mind. Worse, an author who
 * disliked the answer could re-run the job until it came out the other way.
 *
 * So the sample is a pure function of `(pr, head sha)`. The same commit always
 * gets the same answer, nobody can re-roll it, and it needs no state store —
 * the same property the marker ledger relies on elsewhere in this tool.
 *
 * The hash is FNV-1a/32, chosen because it is four lines of arithmetic with no
 * dependency (this tool runs on a bare runner with no `npm ci`). It is not a
 * cryptographic hash and does not need to be: nothing here is a secret, and the
 * input — a git sha — is already uniformly distributed. What is required is
 * determinism and an even spread, and FNV-1a gives both.
 */

/** Share of C-level head shas that still draw a Codex review. */
export const C_SAMPLE_RATE_PERCENT = 20

/**
 * Share of B-level head shas that draw an optional 子牙 / 魏征 / 狄仁杰 spot
 * check. Same stable sampler as C. A miss does not block the merge.
 */
export const B_SPOT_CHECK_RATE_PERCENT = 20

/**
 * FNV-1a, 32-bit. Deterministic across processes and Node versions: only
 * `Math.imul`, XOR and `>>> 0`, all exactly specified by the language.
 *
 * @param {string} text
 * @returns {number} unsigned 32-bit
 */
export function fnv1a32(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * The bucket 0–99 a sampling key falls in. Exported so a test can assert the
 * spread rather than just the stability.
 *
 * @param {string} key
 * @returns {number} 0..99
 */
export function sampleBucket(key) {
  return fnv1a32(String(key)) % 100
}

/**
 * The sampling key for one PR head. `pr` is in the key as well as `sha` so two
 * PRs that happen to share a head commit are decided independently.
 *
 * @param {{pr: number|string, sha: string}} input
 * @returns {string}
 */
export function sampleKey({ pr, sha }) {
  return `${pr}:${sha}`
}

/**
 * @param {{pr: number|string, sha: string, ratePercent?: number}} input
 * @returns {boolean}
 */
export function isSampled({ pr, sha, ratePercent = C_SAMPLE_RATE_PERCENT }) {
  if (!Number.isFinite(ratePercent) || ratePercent <= 0) return false
  if (ratePercent >= 100) return true
  return sampleBucket(sampleKey({ pr, sha })) < ratePercent
}

/**
 * Whether this head sha must draw a Codex review.
 *
 * A and B: always. C: only when the stable sample selects it. An unrecognised
 * level is reviewed — fail closed, the same direction `classifyRisk` fails.
 *
 * @param {{risk: string, pr: number|string, sha: string, ratePercent?: number}} input
 * @returns {{review: boolean, reason: string}}
 */
export function shouldRequestCodexReview({ risk, pr, sha, ratePercent = C_SAMPLE_RATE_PERCENT }) {
  if (risk === 'C') {
    return isSampled({ pr, sha, ratePercent })
      ? { review: true, reason: `C 级，被 ${ratePercent}% 抽样抽中（按 PR+commit 固定，不随重跑改变）` }
      : { review: false, reason: `C 级，未被 ${ratePercent}% 抽样抽中` }
  }
  if (risk === 'A' || risk === 'B') {
    return { review: true, reason: `${risk} 级 —— 必过 Codex 复审` }
  }
  return { review: true, reason: `风险等级 \`${risk}\` 无法识别 —— 按必审处理` }
}

/**
 * Whether this head may draw an optional 子牙 / 魏征 / 狄仁杰 spot check.
 *
 * B only, and only when the stable sample selects it. A uses the two required
 * sign-offs instead. C is not their lane. The result is never an input to
 * `decideMerge`: a `review: false` here must not stop a B or C auto-merge.
 *
 * @param {{risk: string, pr: number|string, sha: string, ratePercent?: number}} input
 * @returns {{review: boolean, reason: string}}
 */
export function shouldRequestLegacySpotCheck({ risk, pr, sha, ratePercent = B_SPOT_CHECK_RATE_PERCENT }) {
  if (risk !== 'B') {
    const reason =
      risk === 'A' || risk === 'C'
        ? `${risk} 级不抽子牙/魏征/狄仁杰（A 级只认两方签字，C 级不抽查）`
        : `风险等级 \`${risk}\` 不抽查，也不挡合并`
    return { review: false, reason }
  }
  if (isSampled({ pr, sha, ratePercent })) {
    return { review: true, reason: `B 级，被 ${ratePercent}% 抽中（可选，缺席不挡合并）` }
  }
  return { review: false, reason: `B 级，未被 ${ratePercent}% 抽中（不挡合并）` }
}
