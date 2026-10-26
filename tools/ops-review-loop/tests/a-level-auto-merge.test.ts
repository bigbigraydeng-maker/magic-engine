import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MERGE_DECISION, decideMerge } from '../src/merge-decision.mjs'
import { FILE_READ_FAILED, classifyRayHoldResponse, readRayHoldFiles } from '../src/ray-file-read.mjs'
import { requiredChecksAreGreen } from '../src/required-checks.mjs'
import { assessRayMergeHold, importsMetaSpendWriter } from '../src/risk.mjs'
import {
  buildSignoffMarker,
  evaluateClaudeHeadSignoff,
  evaluateCodexHeadReview,
  parseSignoffMarkers,
  reviewConversationsResolved,
} from '../src/signoff-marker.mjs'

const HEAD = '41df899e3454e6df9ab2dbee536bf27330d38a55'
const OLD = '4e40ad46a7ab4da7ed2c9e098caf04c1801863de'
const BASE = '430416afda1dddb5aae0fd9d2b0f685e415e2a5f'
const CODEX = 'chatgpt-codex-connector[bot]'
const CLAUDE = 'claude[bot]'
const AUTHOR = 'pr-author'

function codexComment(sha: string) {
  const payload = { code_review: { commit_sha: sha, status: 'completed', has_unresolved_findings: false } }
  return { author: CODEX, body: `<!-- codex-review-state:v1 ${JSON.stringify(payload)} -->` }
}

function claudeMarker(head: string, base = BASE) {
  const [marker] = parseSignoffMarkers([buildSignoffMarker({ base, head, role: 'claude-code' })])
  return { ...marker, author: CLAUDE }
}

function ready(overrides: Record<string, unknown> = {}) {
  return decideMerge({
    risk: 'A',
    draft: false,
    fork: false,
    codexReview: { clear: true },
    claudeSignoff: { clear: true },
    requiredChecksGreen: true,
    conversationsResolved: true,
    rayHold: false,
    ...overrides,
  })
}

describe('A-level auto-merge', () => {
  it('enables when both sign-offs are on this head, checks are green, and every thread is resolved', () => {
    const codexReview = evaluateCodexHeadReview({
      head: HEAD,
      trustedLogin: CODEX,
      prAuthor: AUTHOR,
      comments: [codexComment(HEAD)],
      reviews: [],
      threads: [],
      threadsReadable: true,
    })
    const claudeSignoff = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      comments: [],
      reviews: [],
      markers: [claudeMarker(HEAD, OLD)],
      threads: [],
      threadsReadable: true,
    })
    expect(codexReview.clear).toBe(true)
    expect(claudeSignoff.clear).toBe(true)
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      codexReview,
      claudeSignoff,
      requiredChecksGreen: true,
      conversationsResolved: reviewConversationsResolved({ threads: [], threadsReadable: true }).resolved,
      rayHold: false,
    })
    expect(result.decision).toBe(MERGE_DECISION.ENABLE_AUTO_MERGE)
    expect(result.pass).toBe(true)
    expect(result.tier).toBe('auto')
  })

  it('does not enable when Claude has not signed this head', () => {
    const result = ready({ claudeSignoff: { clear: false, reason: 'Claude Code 还没签过当前这次提交' } })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('Claude Code')
  })

  it('does not enable when either sign-off is for an older head', () => {
    const codexReview = evaluateCodexHeadReview({
      head: HEAD,
      trustedLogin: CODEX,
      prAuthor: AUTHOR,
      comments: [codexComment(OLD)],
      reviews: [],
      threads: [],
      threadsReadable: true,
    })
    const claudeSignoff = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      comments: [],
      reviews: [{ author: CLAUDE, commitId: OLD, state: 'APPROVED', body: 'LGTM' }],
      markers: [claudeMarker(OLD)],
      threads: [],
      threadsReadable: true,
    })
    expect(codexReview.clear).toBe(false)
    expect(codexReview.reason).toContain('更早的提交')
    expect(claudeSignoff.clear).toBe(false)
    expect(claudeSignoff.reason).toContain('更早的提交')
    const result = decideMerge({
      risk: 'A',
      draft: false,
      fork: false,
      codexReview,
      claudeSignoff,
      requiredChecksGreen: true,
      conversationsResolved: true,
      rayHold: false,
    })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
  })

  it('accepts an APPROVED review or a dedicated SIGNED-OFF line, and ignores a refusal', () => {
    const approved = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      reviews: [{ author: 'claude', commitId: HEAD, state: 'APPROVED', body: 'Signed off. No unresolved P0/P1.' }],
      threads: [],
      threadsReadable: true,
    })
    const line = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      comments: [{ author: CLAUDE, body: `Reviewed.\nSIGNED-OFF: ${HEAD}\n` }],
      threads: [],
      threadsReadable: true,
    })
    const refusal = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      comments: [{ author: CLAUDE, body: `Cannot sign-off ${HEAD}: P1 credentials handling is unsafe.` }],
      threads: [],
      threadsReadable: true,
    })
    const quoted = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      comments: [{ author: CLAUDE, body: `Write this line yourself:\n> SIGNED-OFF: ${HEAD}\n\`\`\`\nSIGNED-OFF: ${HEAD}\n\`\`\`` }],
      threads: [],
      threadsReadable: true,
    })
    expect(approved.clear).toBe(true)
    expect(line.clear).toBe(true)
    expect(refusal.clear).toBe(false)
    expect(quoted.clear).toBe(false)
    expect(refusal.reason).toContain('还没签')
  })

  it('does not let the PR author or an open P0 thread count as Claude sign-off', () => {
    const author = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: CLAUDE,
      comments: [{ author: CLAUDE, body: `LGTM ${HEAD}` }],
      threads: [],
      threadsReadable: true,
    })
    const finding = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      reviews: [{ author: CLAUDE, commitId: HEAD, state: 'APPROVED', body: 'LGTM' }],
      threads: [
        {
          resolved: false,
          comments: [{ author: CLAUDE, commitId: HEAD, body: 'P0: this still charges the wrong account' }],
        },
      ],
      threadsReadable: true,
    })
    expect(author.clear).toBe(false)
    expect(finding.clear).toBe(false)
    expect(finding.reason).toContain('P0/P1')
  })

  it('treats an open P2 thread as a conversation that blocks A, without calling it a P0/P1', () => {
    const claudeSignoff = evaluateClaudeHeadSignoff({
      head: HEAD,
      trustedLogin: CLAUDE,
      prAuthor: AUTHOR,
      markers: [claudeMarker(HEAD)],
      threads: [{ resolved: false, comments: [{ author: CODEX, commitId: HEAD, body: 'P2: rename this' }] }],
      threadsReadable: true,
    })
    const conversations = reviewConversationsResolved({
      threads: [{ resolved: false, comments: [] }],
      threadsReadable: true,
    })
    expect(claudeSignoff.clear).toBe(true)
    expect(conversations.resolved).toBe(false)
    expect(ready({ conversationsResolved: false }).decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
  })
})

describe('paths Ray still merges by hand', () => {
  const held = (filename: string) => assessRayMergeHold([{ filename }])

  it('holds a migration, a Meta token file, and Meta campaign or budget writes', () => {
    for (const path of [
      'supabase/migrations/20261025_one.sql',
      'src/lib/meta/token-manager.ts',
      'src/lib/meta/campaign-writes.ts',
    ]) {
      const result = held(path)
      expect(result.hold, path).toBe(true)
      expect(
        decideMerge({
          risk: 'A',
          draft: false,
          fork: false,
          codexReview: { clear: true },
          claudeSignoff: { clear: true },
          requiredChecksGreen: true,
          conversationsResolved: true,
          rayHold: result.hold,
        }).decision,
      ).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    }
  })

  it('holds a rename out of a migration path', () => {
    const result = assessRayMergeHold([
      { filename: 'docs/moved.md', previous_filename: 'supabase/migrations/20261025_one.sql', status: 'renamed' },
    ])
    expect(result.hold).toBe(true)
  })

  it('holds the real Meta credential and ad-spend entry points', () => {
    for (const path of [
      'src/lib/meta-oauth/client.ts',
      'src/lib/meta-oauth/ads-read.ts',
      'src/lib/action-submission/stop-loss.ts',
      'src/app/api/clients/[id]/ad-health/o1-scale/route.ts',
      'src/app/api/clients/[id]/ad-health/stop-loss/route.ts',
      'src/lib/meta/entity-settings.ts',
      'src/lib/ads-strategy/ad-draft.ts',
      'src/lib/marketing-plan/promo/draft-ads.ts',
    ]) {
      expect(held(path).hold, path).toBe(true)
    }
  })

  it('三个广告目录不再整目录扣：读取、展示、评估类文件放行，测试与 docs 放行 (#3200)', () => {
    for (const path of [
      'src/lib/ads-strategy/account-status.ts',
      'src/lib/ads-strategy/digest.ts',
      'src/lib/ads-strategy/war-map/render.ts',
      'src/lib/marketing-plan/promo/board.ts',
      'src/lib/marketing-plan/promo/facts.ts',
      'src/app/api/clients/[id]/ad-health/route.ts',
      'src/lib/ads-strategy/__tests__/ad-draft.test.ts',
      'src/lib/ads-strategy/__tests__/stop-loss.test.ts',
      'src/lib/marketing-plan/promo/__tests__/draft-ads.test.ts',
      'src/lib/ads-strategy/stop-loss.test.ts',
      'docs/ads-strategy/stop-loss.md',
      'docs/specs/launch.sql',
    ]) {
      expect(held(path).hold, path).toBe(false)
    }
  })

  it('🔴 写入类文件仍然扣：开投、止损、预算、出价、暂停、发布', () => {
    for (const path of [
      'src/lib/ads-strategy/stop-loss.ts',
      'src/lib/ads-strategy/auto-pause-pending.ts',
      'src/lib/ads-strategy/launch-readback.ts',
      'src/lib/ads-strategy/launch-budget-headroom.ts',
      'src/lib/ads-strategy/draft-and-gate.ts',
      'src/lib/marketing-plan/promo/budget-caps.ts',
      'src/lib/marketing-plan/promo/draft-ads.ts',
      'src/app/api/clients/[id]/ad-health/o1-scale/route.ts',
      'src/app/api/clients/[id]/ad-health/execute-prescription/route.ts',
      'src/app/api/clients/[id]/ad-health/activate/route.ts',
    ]) {
      expect(held(path).hold, path).toBe(true)
    }
  })

  it('🔴 目录里看起来无害的文件一旦导入 Meta 花钱模块，照样扣；读不到时也扣（fail closed）', () => {
    const path = 'src/lib/ads-strategy/digest.ts'
    const importing = "import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'\n"
    expect(assessRayMergeHold([{ filename: path }], { [path]: importing }).hold).toBe(true)
    expect(assessRayMergeHold([{ filename: path }], { [path]: FILE_READ_FAILED }).hold).toBe(true)
    expect(assessRayMergeHold([{ filename: path }], { [path]: null }).hold).toBe(true)
    expect(assessRayMergeHold([{ filename: path }], { [path]: 'export const n = 1\n' }).hold).toBe(false)
  })

  it('测试文件里 mock 花钱模块不扣；非测试文件导入照扣', () => {
    const mocked = "vi.mock('@/lib/meta/campaign-writes')\nimport { x } from '@/lib/meta/campaign-writes'\n"
    const test = 'src/lib/ads-strategy/__tests__/digest.test.ts'
    expect(assessRayMergeHold([{ filename: test }], { [test]: mocked }).hold).toBe(false)
    const prod = 'src/lib/ads-strategy/digest.ts'
    expect(assessRayMergeHold([{ filename: prod }], { [prod]: mocked }).hold).toBe(true)
  })

  it('docs 下的 .sql 示例放行；migration 与其它位置的 .sql 仍然扣', () => {
    expect(held('docs/examples/query.sql').hold).toBe(false)
    expect(held('scripts/query.sql').hold).toBe(true)
    expect(held('supabase/migrations/20261026_a.sql').hold).toBe(true)
    expect(
      assessRayMergeHold([{ filename: 'docs/moved.sql', previous_filename: 'supabase/migrations/x.sql', status: 'renamed' }]).hold,
    ).toBe(true)
  })

  it('holds a file that imports a Meta spend writer even when its path is not listed', () => {
    const path = 'src/lib/not-on-the-list/bridge.ts'
    const importing = "import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'\n"
    expect(importsMetaSpendWriter(importing)).toBe(true)
    expect(assessRayMergeHold([{ filename: path }], { [path]: importing }).hold).toBe(true)
    expect(assessRayMergeHold([{ filename: path }], { [path]: 'export const n = 1\n' }).hold).toBe(false)
    expect(assessRayMergeHold([{ filename: path }], { [path]: null }).hold).toBe(true)
  })

  it('does not hold a file that is too large to read when the diff does not touch spend (#3133)', () => {
    const path = 'src/app/dashboard/clients/[id]/execution/_client.tsx'
    const patch = [
      '@@ -1159,7 +1159,7 @@ function TaskDetailDrawer({',
      '               href={',
      '-                  : `/dashboard/clients/${clientId}/daily-plan`',
      '+                  : `/dashboard/clients/${clientId}/production`',
      '             >',
    ].join('\n')
    const result = assessRayMergeHold([{ filename: path, patch }], { [path]: null })
    expect(result.hold).toBe(false)
    expect(result.reason).toBe('')
  })

  it('holds an unread file when the diff imports a spend writer, and when the diff is missing', () => {
    const path = 'src/app/dashboard/clients/[id]/execution/_client.tsx'
    const patch = "+import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'\n"
    const imported = assessRayMergeHold([{ filename: path, patch }], { [path]: null })
    expect(imported.hold).toBe(true)
    expect(imported.reason).toContain('diff 导入了 Meta 广告写入模块')

    const missing = assessRayMergeHold([{ filename: path }], { [path]: null })
    expect(missing.hold).toBe(true)
    expect(missing.reason).toContain('diff 也没有')
    expect(missing.reason).toContain('库表')
    expect(missing.reason).toContain('Meta 凭证')
    expect(missing.reason).toContain('广告花费')
  })

  it('still holds schema, Meta credential, and ad-spend paths when the diff looks harmless', () => {
    const patch = '+const label = "renamed"\n'
    for (const path of [
      'supabase/migrations/20261025_one.sql',
      'src/lib/meta/token-manager.ts',
      'src/lib/meta/campaign-writes.ts',
      'src/app/api/clients/[id]/ad-health/stop-loss/route.ts',
    ]) {
      const result = assessRayMergeHold([{ filename: path, patch }], { [path]: null })
      expect(result.hold, path).toBe(true)
    }
  })

  it('still holds a readable file that imports a spend writer even if this hunk does not', () => {
    const path = 'src/lib/not-on-the-list/bridge.ts'
    const result = assessRayMergeHold(
      [{ filename: path, patch: '+const label = "copy"\n' }],
      { [path]: "import { pause } from '@/lib/meta/ad-publisher'\n" },
    )
    expect(result.hold).toBe(true)
    expect(result.reason).toContain('导入了 Meta 广告写入模块')
  })

  it('does not hold kernel code, a sitemap budget, Meta insights, or a non-Meta budget', () => {
    for (const path of [
      'src/lib/kernel/state.ts',
      'src/lib/site-audit/sitemap-budget.ts',
      'src/lib/meta/campaign-insights.ts',
      'src/lib/google-ads/budget.ts',
    ]) {
      expect(held(path).hold, path).toBe(false)
    }
  })

  it('reads a file over 64KB whole, including through the git blob, and still holds an old spend import (#3133 P1)', () => {
    const path = 'src/app/dashboard/clients/[id]/execution/_client.tsx'
    const sha = 'a'.repeat(40)
    const ref = 'b'.repeat(40)
    const harmless = '+const label = "copy"\n'
    const importing = `import { pause } from '@/lib/meta/ad-publisher'\n${'x'.repeat(70 * 1024)}`
    const quiet = `export const n = 1\n${'y'.repeat(70 * 1024)}`

    const inline = async (text: string) => {
      const body = Buffer.from(text).toString('base64')
      const contents = await readRayHoldFiles({
        files: [{ filename: path, sha, patch: harmless }],
        repository: 'acme/repo',
        ref,
        token: 't',
        fetchImpl: async (url) => {
          if (url.includes('/git/blobs/')) throw new Error('complete contents body should not call the blob API')
          expect(url).toContain('%5Bid%5D')
          return {
            status: 200,
            text: async () => JSON.stringify({ type: 'file', encoding: 'base64', size: Buffer.byteLength(text), sha, content: body }),
          }
        },
      })
      return assessRayMergeHold([{ filename: path, patch: harmless }], contents)
    }

    return inline(importing).then((held) => {
      expect(held.hold).toBe(true)
      expect(held.reason).toContain('导入了 Meta 广告写入模块')
      expect(held.reason).not.toContain('diff 导入')
      return inline(quiet)
    }).then((quietHold) => {
      expect(quietHold.hold).toBe(false)
    }).then(async () => {
      const source = `import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'\nconst n = 1\n`
      let sawBlob = false
      const contents = await readRayHoldFiles({
        files: [{ filename: path, sha, patch: harmless }],
        repository: 'acme/repo',
        ref,
        token: 't',
        fetchImpl: async (url, init) => {
          const accept = init?.headers?.Accept ?? ''
          if (url.includes('/contents/')) {
            return {
              status: 403,
              text: async () => JSON.stringify({
                message: 'This API returns blobs up to 1 MB in size. The requested blob is too large',
                errors: [{ code: 'too_large' }],
              }),
            }
          }
          if (accept.includes('github.raw')) {
            sawBlob = true
            return { status: 200, text: async () => source }
          }
          sawBlob = true
          return { status: 200, text: async () => JSON.stringify({ sha, size: Buffer.byteLength(source) }) }
        },
      })
      const held = assessRayMergeHold([{ filename: path, patch: harmless }], contents)
      expect(sawBlob).toBe(true)
      expect(contents[path]).toContain('campaign-writes')
      expect(held.hold).toBe(true)
      expect(held.reason).toContain('导入了 Meta 广告写入模块')
      expect(held.reason).not.toContain('文件读取失败')
    })
  })

  it('keeps a failed file read for Ray, and still uses the diff only when the file is too big', () => {
    const path = 'src/lib/not-on-the-list/bridge.ts'
    const sha = 'c'.repeat(40)
    const ref = 'd'.repeat(40)
    const patch = '+const label = "copy"\n'
    const over = classifyRayHoldResponse({
      phase: 'contents',
      status: 200,
      json: { type: 'file', encoding: 'base64', size: 100 * 1024 * 1024 + 1, content: 'YQ==', sha },
      knownSha: sha,
    })
    const failed = classifyRayHoldResponse({ phase: 'contents', status: 500, text: 'boom' })
    const limited = classifyRayHoldResponse({ phase: 'contents', status: 429, text: 'rate limit' })
    const blobTooBig = classifyRayHoldResponse({
      phase: 'blob',
      status: 403,
      text: 'this blob is too large',
      knownSha: sha,
    })
    const blobUnprocessable = classifyRayHoldResponse({
      phase: 'blob',
      status: 422,
      json: { message: 'blob too large', errors: [{ code: 'too_large' }] },
      knownSha: sha,
    })
    expect(over.kind).toBe('too-big')
    expect(failed.kind).toBe('failed')
    expect(limited.kind).toBe('failed')
    expect(blobTooBig.kind).toBe('too-big')
    expect(blobUnprocessable.kind).toBe('too-big')

    const tooBig = assessRayMergeHold([{ filename: path, patch }], { [path]: null })
    expect(tooBig.hold).toBe(false)

    const unread = assessRayMergeHold([{ filename: path, patch }], { [path]: FILE_READ_FAILED })
    expect(unread.hold).toBe(true)
    expect(unread.reason).toContain('文件读取失败')

    const schema = assessRayMergeHold(
      [{ filename: 'supabase/migrations/20261025_one.sql', patch }],
      { 'supabase/migrations/20261025_one.sql': FILE_READ_FAILED },
    )
    expect(schema.hold).toBe(true)
    expect(schema.reason).toContain('数据库 migration')

    const spendPath = assessRayMergeHold(
      [{ filename: 'src/lib/meta/campaign-writes.ts', patch }],
      { 'src/lib/meta/campaign-writes.ts': FILE_READ_FAILED },
    )
    expect(spendPath.hold).toBe(true)
    expect(spendPath.reason).toContain('改 Meta 广告系列预算或状态')

    return readRayHoldFiles({
      files: [{ filename: path, sha, patch }],
      repository: 'acme/repo',
      ref,
      token: 't',
      fetchImpl: async () => {
        throw new Error('socket hang up')
      },
    }).then((contents) => {
      expect(contents[path]).toBe(FILE_READ_FAILED)
      const held = assessRayMergeHold([{ filename: path, patch }], contents)
      expect(held.hold).toBe(true)
      expect(held.reason).toContain('文件读取失败')
    })
  })

  it('trusts a 404 only when the file list says the file was removed', async () => {
    const path = 'src/lib/not-on-the-list/bridge.ts'
    const sha = 'e'.repeat(40)
    const ref = 'f'.repeat(40)
    const patch = '-const label = "old"\n'
    const notRemoved = classifyRayHoldResponse({ phase: 'contents', status: 404, text: 'Not Found' })
    const removedKind = classifyRayHoldResponse({
      phase: 'contents',
      status: 404,
      text: 'Not Found',
      removed: true,
    })
    const blobMissing = classifyRayHoldResponse({ phase: 'blob', status: 404, knownSha: sha, removed: true })
    expect(notRemoved.kind).toBe('failed')
    expect(removedKind.kind).toBe('missing')
    expect(blobMissing.kind).toBe('failed')

    const fetch404 = async () => ({ status: 404, text: async () => JSON.stringify({ message: 'Not Found' }) })
    const read = (status: string | undefined) =>
      readRayHoldFiles({
        files: [{ filename: path, sha, ...(status ? { status } : {}), patch }],
        repository: 'acme/repo',
        ref,
        token: 't',
        fetchImpl: fetch404,
      })

    const stillThere = await read('modified')
    expect(stillThere[path]).toBe(FILE_READ_FAILED)
    const held = assessRayMergeHold([{ filename: path, status: 'modified', patch }], stillThere)
    expect(held.hold).toBe(true)
    expect(held.reason).toContain('文件读取失败')
    expect(held.reason).not.toContain('diff 导入')

    const unmarked = await read(undefined)
    expect(unmarked[path]).toBe(FILE_READ_FAILED)
    expect(assessRayMergeHold([{ filename: path, patch }], unmarked).hold).toBe(true)

    const gone = await read('removed')
    expect(gone[path]).toBeNull()
    const released = assessRayMergeHold([{ filename: path, status: 'removed', patch }], gone)
    expect(released.hold).toBe(false)
    expect(released.reason).toBe('')

    const spendPatch = "-import { pause } from '@/lib/meta/ad-publisher'\n"
    const deletedSpend = await readRayHoldFiles({
      files: [{ filename: path, sha, status: 'removed', patch: spendPatch }],
      repository: 'acme/repo',
      ref,
      token: 't',
      fetchImpl: fetch404,
    })
    const spendHold = assessRayMergeHold([{ filename: path, status: 'removed', patch: spendPatch }], deletedSpend)
    expect(spendHold.hold).toBe(true)
    expect(spendHold.reason).toContain('diff 导入了 Meta 广告写入模块')

    const renamedSha = 'a'.repeat(40)
    const next = 'src/lib/not-on-the-list/next.ts'
    const quiet = 'export const n = 1\n'
    const renamed = await readRayHoldFiles({
      files: [{ filename: next, previous_filename: path, status: 'renamed', sha: renamedSha, patch }],
      repository: 'acme/repo',
      ref,
      token: 't',
      fetchImpl: async (url) => {
        if (url.includes('/next.ts')) {
          return {
            status: 200,
            text: async () =>
              JSON.stringify({
                type: 'file',
                encoding: 'base64',
                size: Buffer.byteLength(quiet),
                sha: renamedSha,
                content: Buffer.from(quiet).toString('base64'),
              }),
          }
        }
        return { status: 404, text: async () => JSON.stringify({ message: 'Not Found' }) }
      },
    })
    expect(renamed[next]).toContain('export const n')
    expect(renamed[path]).toBe(FILE_READ_FAILED)
    const renameHold = assessRayMergeHold(
      [{ filename: next, previous_filename: path, status: 'renamed', patch }],
      renamed,
    )
    expect(renameHold.hold).toBe(true)
    expect(renameHold.reason).toContain('文件读取失败')
  })

  it('wires the Ray hold through the blob reader instead of the 64KB contents cap', () => {
    const source = readFileSync(join(process.cwd(), 'tools/ops-review-loop/src/check-risk-gate.mjs'), 'utf8')
    expect(source).toContain('readRayHoldFiles')
    expect(source).not.toContain('assessRayMergeHold(files, sourcePaths')
  })

  it('fails closed when the file list cannot be read, and a held path blocks B as well', () => {
    expect(assessRayMergeHold(undefined).hold).toBe(true)
    expect(assessRayMergeHold([]).hold).toBe(true)
    const result = decideMerge({
      risk: 'B',
      draft: false,
      fork: false,
      codexReview: { clear: true },
      rayHold: true,
    })
    expect(result.decision).toBe(MERGE_DECISION.DISABLE_AUTO_MERGE)
    expect(result.needsRayMerge).toBe(true)
    expect(result.reason).toContain('Ray')
  })
})

describe('required checks', () => {
  it('ignores a red Risk gate and still requires every other required check', () => {
    expect(
      requiredChecksAreGreen({
        requiredNames: ['Risk gate', 'ops-review-loop-tests'],
        checks: [
          { name: 'Risk gate', status: 'completed', conclusion: 'failure' },
          { name: 'ops-review-loop-tests', status: 'completed', conclusion: 'success' },
        ],
        checksReadable: true,
      }),
    ).toBe(true)
  })

  it('uses completedAt when the same check was rerun, and does not trust array order without it', () => {
    const older = { name: 'ops-review-loop-tests', status: 'completed', conclusion: 'failure', completedAt: '2026-10-24T00:00:00Z' }
    const newer = { name: 'ops-review-loop-tests', status: 'completed', conclusion: 'success', completedAt: '2026-10-24T01:00:00Z' }
    const laterFail = { name: 'ops-review-loop-tests', status: 'completed', conclusion: 'failure', completedAt: '2026-10-24T02:00:00Z' }
    expect(requiredChecksAreGreen({ requiredNames: ['ops-review-loop-tests'], checks: [older, newer], checksReadable: true })).toBe(true)
    expect(requiredChecksAreGreen({ requiredNames: ['ops-review-loop-tests'], checks: [newer, older], checksReadable: true })).toBe(true)
    expect(requiredChecksAreGreen({ requiredNames: ['ops-review-loop-tests'], checks: [newer, laterFail], checksReadable: true })).toBe(false)
    const plainFail = { name: 'ops-review-loop-tests', status: 'completed', conclusion: 'failure' }
    const plainOk = { name: 'ops-review-loop-tests', status: 'completed', conclusion: 'success' }
    expect(requiredChecksAreGreen({ requiredNames: ['ops-review-loop-tests'], checks: [plainOk, plainFail], checksReadable: true })).toBe(false)
    expect(requiredChecksAreGreen({ requiredNames: ['ops-review-loop-tests'], checks: [plainFail, plainOk], checksReadable: true })).toBe(false)
  })

  it('fails closed when the only required check is this gate, or the rollup is unread', () => {
    expect(
      requiredChecksAreGreen({
        requiredNames: ['Risk gate'],
        checks: [{ name: 'Risk gate', status: 'completed', conclusion: 'success' }],
        checksReadable: true,
      }),
    ).toBe(false)
    expect(
      requiredChecksAreGreen({
        requiredNames: ['ops-review-loop-tests'],
        checks: [],
        checksReadable: false,
      }),
    ).toBe(false)
    expect(requiredChecksAreGreen({ requiredNames: [], checks: [], checksReadable: true })).toBe(false)
  })
})
