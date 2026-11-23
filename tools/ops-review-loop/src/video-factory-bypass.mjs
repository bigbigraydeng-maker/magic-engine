/**
 * Static early-warning guard for the "video factory is the only publish path"
 * rule (CLAUDE.md §8, `docs/agents/14-sudongpo.md`, `docs/PITFALLS.md` D14,
 * decision card `docs/ledger/2026-09-29-video-factory-only-rule.md`).
 *
 * 🔴 **What this is a defence against, and what it is not.**
 *
 * The 2026-09-28 East Inter incident was a one-off script, outside
 * `src/lib/factory/`, that called a video-generation provider (Muapi) and
 * then called Facebook's publish endpoint directly — skipping the recipe
 * check, the storyboard self-check and the fact-grounding step that the
 * factory pipeline runs. The script was never committed to the repository,
 * so no code review, CI check or runtime function this repo defines could
 * ever have seen it run. That is the actual gap this rates as un-closeable
 * by anything living in `src/`: a script that never imports this codebase's
 * own functions cannot be stopped by gating those functions.
 *
 * What this check *can* do is stop the same shape from becoming a *reusable,
 * reviewable asset in this repository* — the point at which "one person ran
 * this once" turns into "this is now how we do it," and the point CI can
 * actually see. A PR that adds a file outside `src/lib/factory/` whose new
 * lines call both a known video-generation provider and a known video
 * publish endpoint is exactly the shape of the incident, and is flagged.
 *
 * A runtime chokepoint (gating a single shared "publish video" function with
 * a kernel-style authorization envelope, the way `src/lib/kernel/` already
 * gates ads actions) was considered and rejected for this PR: there is no
 * single low-level function every publish path already funnels through —
 * `src/lib/factory/publish/facebook-reel-adapter.ts`,
 * `src/lib/meta/ad-publisher.ts` and `src/lib/social/facebook-publisher.ts`
 * each build their own `fetch()` calls — and more fundamentally, the incident
 * script bypassed this repo's functions entirely, so gating any one of them
 * would not have caught it either. Building that chokepoint would mean
 * refactoring every existing Graph API caller, which touches
 * `src/lib/factory/` internals this PR is scoped to leave alone. Recorded as
 * a known gap in the ledger card, not silently dropped.
 *
 * Only scans the *added* lines of each changed file (from the GitHub PR
 * files API `patch` field) — this is about what a PR introduces, not about
 * flagging pre-existing code the PR merely touches. A file whose diff has no
 * `patch` (GitHub omits it for very large diffs, renames-only, or binaries)
 * fails closed: "could not read" and "nothing suspicious" must not look the
 * same, the same rule `risk.mjs` and `fix-scope.mjs` already apply.
 */

/** The directory that is the sanctioned video-production entry point. */
export const FACTORY_PREFIX = 'src/lib/factory/'

/**
 * This guard's own control plane. It necessarily *defines* the provider and
 * publish needles as source-code string literals — the file you are reading
 * right now names `api.muapi.ai` and `video_reels` in the same breath — so
 * scanning it against its own rule would flag itself on every PR that touches
 * it. Excluding it does not open a real hole: anything under this prefix is
 * already forced to A-level human review by `risk.mjs`'s own
 * `CONTROL_PLANE` rule (`tools/ops-review-loop/` is on that list precisely
 * because it decides PRs' fates), so a change here already cannot pass
 * without a person looking at it, independent of this narrower check.
 */
export const SELF_PREFIX = 'tools/ops-review-loop/'

/**
 * File extensions this check actually scans. Video-gen and publish calls run
 * as executable code — flagging a `.md`/`.json`/doc hit would just mean the
 * incident's own postmortem (which quotes these exact strings in prose)
 * flags itself forever. Docs are out of scope for a "does this code call
 * both APIs" question by construction, not by an exemption someone could
 * quietly widen.
 */
export const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']

/**
 * 🔴 Known gap, flagged in 子牙's review of PR #2177: this is a *name* check,
 * not proof the file actually runs under vitest. `scratchpad/foo.test.mjs`
 * matches it and is never executed by anything — it is exactly as runnable a
 * standalone script as `scratchpad/foo.mjs`, just wearing a test-shaped name.
 * A committed bypass script can dodge this check by adopting that name.
 *
 * So a match here does NOT skip the file outright (that would silently pass
 * the exact evasion above). It only downgrades a real hit from a failing
 * `violation` to a non-failing `notice` — still visible in the job summary,
 * never silent — because a *genuine* test file legitimately has to spell out
 * these needles as string literals to test this guard at all (this repo's own
 * `video-factory-bypass.test.ts` does exactly that), and failing every such
 * test would make writing one impossible. See `docs/ledger/2026-09-29-video-
 * factory-bypass-gate.md` known-gap ④ for the honest statement of what this
 * does and does not close.
 */
const TEST_FILE_RE = /(\.(test|spec)\.[a-z]+$)|(^|\/)(__tests__|tests)\//i

/**
 * Needles that mean "this line talks to a video-generation provider".
 * Real hostnames, not the repo's own wrapper module names — the incident
 * script never imported `src/lib/muapi/` or `src/lib/visual/`, it hit the
 * provider's API directly. WaveSpeed and Seedance are both routed through
 * Atlas Cloud today (`src/lib/visual/atlas.ts`, `wavespeed.ts`, `seedance.ts`
 * all point at `api.atlascloud.ai`) — one needle covers all three brand
 * names as used in this repo.
 */
export const VIDEO_PROVIDER_SIGNATURES = [
  { needle: 'api.muapi.ai', why: 'Muapi（Visual Studio / Video Studio）视频生成接口' },
  { needle: 'api.atlascloud.ai', why: 'Atlas Cloud（WaveSpeed / Seedance 视频生成走这个域名）接口' },
  { needle: 'muapi_api_key', why: 'Muapi 密钥变量名' },
  { needle: 'atlas_cloud_api_key', why: 'Atlas Cloud 密钥变量名' },
]

/**
 * Needles that mean "this line publishes a video to a platform we manage".
 * `video_reels` and `media_publish` are specific enough to video/reel publish
 * flows on their own (Facebook Reels, Instagram container-publish) that they
 * don't need a companion hostname check. A bare `/videos` path is common
 * enough elsewhere that it is only counted alongside a Graph API hostname on
 * the same line set.
 */
export const PUBLISH_SIGNATURES = [
  { needle: 'video_reels', why: 'Facebook Reel 发布接口（/video_reels）' },
  { needle: 'media_publish', why: 'Instagram 发布接口（/media_publish）' },
]

/** Graph API hostname — only meaningful paired with a bare `/videos` path. */
const GRAPH_HOST_RE = /graph\.facebook\.com/i
const BARE_VIDEOS_PATH_RE = /\/videos\b/i

function extensionOf(path) {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

/** Lines a unified diff patch actually added — strips the `+` marker, skips `+++`. */
function addedLines(patch) {
  if (typeof patch !== 'string' || patch === '') return []
  return patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
}

/**
 * @param {string} text lower-cased added-lines text for one file
 * @param {Array<{needle: string, why: string}>} signatures
 * @returns {{needle: string, why: string} | null} the first match, or null
 */
function firstSignatureHit(text, signatures) {
  return signatures.find((sig) => text.includes(sig.needle)) ?? null
}

/**
 * Decide whether one changed file's added lines match the incident shape.
 *
 * @param {{filename: string, patch?: string}} file
 * @returns {{skipped: true} | {skipped: false, unreadable: boolean, violation: string | null, notice?: string}}
 */
export function checkFile(file) {
  const path = file?.filename
  if (typeof path !== 'string' || path === '') {
    return { skipped: false, unreadable: true, violation: '改动清单里有一项没有文件名 —— 判不出，按需要人工复核处理' }
  }
  if (path.startsWith(FACTORY_PREFIX)) return { skipped: true }
  if (path.startsWith(SELF_PREFIX)) return { skipped: true }
  if (!SCANNED_EXTENSIONS.includes(extensionOf(path))) return { skipped: true }

  const isTestShaped = TEST_FILE_RE.test(path)

  const lines = addedLines(file.patch)
  if (lines.length === 0 && file.patch === undefined) {
    // Large diff / binary / rename-only: GitHub omitted the patch. Could not
    // read it, not "nothing there" — fail closed like risk.mjs does for an
    // unreadable entry.
    return {
      skipped: false,
      unreadable: true,
      violation: `${path} —— 改动太大或没有可读的 patch，判不出是否绕开视频工厂，按需要人工复核处理`,
    }
  }

  const text = lines.join('\n').toLowerCase()
  const providerHit = firstSignatureHit(text, VIDEO_PROVIDER_SIGNATURES)
  if (!providerHit) return { skipped: false, unreadable: false, violation: null }

  const publishHit =
    firstSignatureHit(text, PUBLISH_SIGNATURES) ??
    (GRAPH_HOST_RE.test(text) && BARE_VIDEOS_PATH_RE.test(text)
      ? { needle: '/videos', why: 'Facebook Graph API 视频发布路径（/videos）' }
      : null)
  if (!publishHit) return { skipped: false, unreadable: false, violation: null }

  const message =
    `${path} —— 新增代码里同时出现视频生成接口（${providerHit.why}）和发布接口（${publishHit.why}），` +
    `又不在 \`${FACTORY_PREFIX}\` 之下：这正是 2026-09-28 East Inter 事故的绕法（见 PITFALLS D14）`

  if (isTestShaped) {
    // Downgraded, not silent: could be a bypass script wearing a test-shaped
    // name (this check cannot tell), could be a genuine test. Either way a
    // human sees it in the job summary; it just does not fail the merge gate
    // on its own. See the TEST_FILE_RE doc comment above.
    return { skipped: false, unreadable: false, violation: null, notice: `${message}（文件名形似测试文件，降级为提醒，不拦）` }
  }

  return { skipped: false, unreadable: false, violation: message }
}

/**
 * Decide whether a PR's changed files match the "another script bypassing
 * the video factory" shape.
 *
 * @param {{files: Array<{filename: string, patch?: string}>}} input
 * @returns {{ok: boolean, violations: string[], notices: string[]}}
 */
export function checkVideoFactoryBypass({ files }) {
  if (!Array.isArray(files)) {
    return { ok: false, violations: ['拿不到改动文件清单 —— 闸门无法判定，按失败处理'], notices: [] }
  }

  const violations = []
  const notices = []
  for (const file of files) {
    const result = checkFile(file)
    if (result.skipped) continue
    if (result.violation) violations.push(result.violation)
    if (result.notice) notices.push(result.notice)
  }

  return { ok: violations.length === 0, violations, notices }
}
