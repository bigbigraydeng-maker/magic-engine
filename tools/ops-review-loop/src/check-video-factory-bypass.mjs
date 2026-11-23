/**
 * Required-check entrypoint for the video-factory-only-publish-path guard.
 *
 * Runs on every `pull_request` event, no branch or path filter — any window,
 * on any branch, could commit the kind of one-off script the 2026-09-28 East
 * Inter incident used. Reads the PR's changed files (including each file's
 * diff `patch`) from the GitHub API and fails the job if any changed file
 * outside `src/lib/factory/` matches the incident's shape: a video-generation
 * provider call and a video-publish call added in the same file.
 *
 * Checked out from `main` by its workflow, so a PR cannot edit the guard that
 * judges it — same pattern as `check-fix-scope.mjs`.
 */

import { appendFileSync } from 'node:fs'

import { checkVideoFactoryBypass } from './video-factory-bypass.mjs'

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const pr = process.env.PR_NUMBER

/** Paginated list of files changed by the PR, each with its diff `patch`. */
async function listPullRequestFiles() {
  const files = []
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pr}/files?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (!res.ok) {
      throw new Error(`GitHub API pulls/${pr}/files failed: ${res.status} ${await res.text()}`)
    }
    const batch = await res.json()
    files.push(...batch)
    if (batch.length < 100) break
  }
  return files
}

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  }
  console.log(text)
}

// Any failure to *evaluate* the guard is a failure, never a pass — "we could
// not check" and "there was nothing wrong" must not look the same.
let files
try {
  files = await listPullRequestFiles()
} catch (err) {
  summary(`## ❌ 视频工厂唯一出口闸门：无法读取改动清单\n\n${err.message}\n\n按失败处理。`)
  process.exit(1)
}

const result = checkVideoFactoryBypass({ files })

if (result.ok) {
  const notice =
    result.notices.length > 0
      ? `\n\n> ⚠️ 但有 ${result.notices.length} 处文件名形似测试文件、内容却同时命中两个信号，没有拦但请人工看一眼：\n` +
        result.notices.map((n) => `> - ${n}`).join('\n')
      : ''
  summary(
    `## ✅ 视频工厂唯一出口闸门：通过\n\n改动 ${files.length} 个文件，没有在 \`src/lib/factory/\` 之外发现「同一文件里既调视频生成接口又调发布接口」这种绕过形状。${notice}`,
  )
  process.exit(0)
}

summary(
  [
    '## ❌ 视频工厂唯一出口闸门：不通过',
    '',
    '本 PR 的改动疑似绕开视频工厂（`src/lib/factory/`）直接生产并发布视频——2026-09-28 East Inter 事故就是这个绕法（见 [PITFALLS D14](https://github.com/' +
      `${owner}/${repo}` +
      '/blob/main/docs/PITFALLS.md)）：',
    '',
    ...result.violations.map((v) => `- ${v}`),
    '',
    '> 这道闸门只看**这个 PR 新增的代码实际调了什么接口**，不看提交信息或注释怎么写。',
    '> 如果这些代码确实需要生产视频并发布，请改走 `src/lib/factory/` 现有流程（查配方 → 出对账表 → 分镜自检 → 发布），',
    '> 而不是另写一条绕开检查的路径。',
    '> 这道闸门本身也有已知的边界：它只能看见**提交进本仓库**的代码，挡不住「本地跑一次、从不提交」这种绕法——',
    '> 见 `tools/ops-review-loop/src/video-factory-bypass.mjs` 顶部注释和决定卡 `docs/ledger/2026-09-29-video-factory-only-rule.md`。',
  ].join('\n'),
)
process.exit(1)
