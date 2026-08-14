/**
 * Required-check entrypoint for the auto-fix blast-radius guard.
 *
 * Runs on every `pull_request` event. For PRs on the lane the Codex-to-Claude
 * auto-fix leg can push to, it reads the PR's changed files from the API and
 * fails the job if the change left the allowed blast radius (see
 * ./fix-scope.mjs for what is protected and why).
 *
 * Checked out from `main` by its workflow, so a PR cannot edit the guard that
 * judges it — and `.github/workflows/` plus `tools/ops-review-loop/` are on
 * the protected list, so it cannot edit it on a later round either.
 */

import { appendFileSync } from 'node:fs'

import { checkFixScope } from './fix-scope.mjs'

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const pr = process.env.PR_NUMBER
const branch = process.env.PR_HEAD_REF ?? ''

/** Paginated list of files changed by the PR. */
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
  summary(`## ❌ 自动修爆炸半径闸门：无法读取改动清单\n\n${err.message}\n\n按失败处理。`)
  process.exit(1)
}

const result = checkFixScope({ branch, files })

if (!result.applies) {
  summary(`## ⏭️ 自动修爆炸半径闸门：不适用\n\n分支 \`${branch}\` 不在自动修可推送的车道上。`)
  process.exit(0)
}

if (result.ok) {
  summary(
    `## ✅ 自动修爆炸半径闸门：通过\n\n分支 \`${branch}\` 在车道内，改动 ${files.length} 个文件，未触碰任何受保护路径。`,
  )
  process.exit(0)
}

summary(
  [
    '## ❌ 自动修爆炸半径闸门：不通过',
    '',
    `分支 \`${branch}\` 在 Codex→Claude 自动修可推送的车道上，本 PR 的改动越界了：`,
    '',
    ...result.violations.map((v) => `- ${v}`),
    '',
    '> 这道闸门**不看提示词、不看模型有没有听话**，只看最终改了什么 —— 提示词围栏不是安全边界。',
    '> 如果这些改动是人有意为之，请换一个不在本车道的分支前缀提交，让它作为一次可见、可复审的动作。',
  ].join('\n'),
)
process.exit(1)
