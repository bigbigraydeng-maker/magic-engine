// Read-only PR patrol (issue #3478 PR-1). Replaces the Grok polling loop.
// Lists open non-draft PRs, derives problems from live check runs and PR age,
// and keeps ONE machine comment on the tracking issue up to date. No change in
// state => no write at all. Never merges, deploys, or touches contents.
import { createHash } from 'node:crypto'

export const MARKER = 'pr-patrol-state:v1'
export const STALE_HOURS = 48
const RISK_GATE = 'Risk gate'
const BAD = ['failure', 'timed_out', 'cancelled', 'action_required']

/** Pure: turn one PR + its head check runs into a sorted list of problem kinds. */
export function classifyPr(pr, checkRuns, now = Date.now(), staleHours = STALE_HOURS) {
  const problems = new Set()
  const gate = checkRuns.find((run) => run.name === RISK_GATE)
  for (const run of checkRuns) {
    if (run.name === RISK_GATE) continue
    if (!BAD.includes(run.conclusion)) continue
    problems.add(/fix-scope/i.test(run.name) ? 'fix-scope-red' : 'checks-red')
  }
  if (gate && BAD.includes(gate.conclusion)) problems.add('risk-gate-red')
  if (!gate) problems.add('risk-gate-missing')
  const ageH = (now - Date.parse(pr.updated_at)) / 3_600_000
  if (ageH >= staleHours) problems.add('stale')
  return [...problems].sort()
}

/** Pure: stable keys like "123:checks-red@abc1234" (a new push changes the sha, so it is a new key). */
export function problemKeys(items) {
  return items
    .flatMap((item) => item.problems.map((kind) => `${item.number}:${kind}@${item.sha.slice(0, 7)}`))
    .sort()
}

export function fingerprint(keys) {
  return createHash('sha256').update(keys.join('\n')).digest('hex').slice(0, 16)
}

export function parseState(body) {
  const m = new RegExp(`<!-- ${MARKER} (\\{.*?\\}) -->`).exec(body ?? '')
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

/** Pure: decide what to write. Same fingerprint => nothing. */
export function plan(prev, keys) {
  const fp = fingerprint(keys)
  if (prev && prev.fp === fp) return { write: false, fp, added: [], recovered: [] }
  const before = new Set(prev?.keys ?? [])
  const now = new Set(keys)
  return {
    write: true,
    fp,
    added: keys.filter((k) => !before.has(k)),
    recovered: [...before].filter((k) => !now.has(k)),
  }
}

export function renderBody(items, keys, fp, nowIso) {
  const rows = items
    .filter((i) => i.problems.length)
    .map((i) => `| #${i.number} | ${i.problems.join(', ')} | \`${i.sha.slice(0, 7)}\` |`)
  const table = rows.length ? ['| PR | 问题 | 提交 |', '|---|---|---|', ...rows].join('\n') : '当前没有卡住的 PR。'
  return [
    `<!-- ${MARKER} ${JSON.stringify({ fp, keys })} -->`,
    '### PR 巡查（只读，状态有变化才更新）',
    table,
    `检查了 ${items.length} 个开着的非草稿 PR · ${nowIso}`,
  ].join('\n\n')
}

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path} -> ${res.status}`)
  return res.json()
}

async function findExisting(repo, issue) {
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`)
    const hit = batch.find((c) => c.body?.includes(`<!-- ${MARKER}`))
    if (hit) return hit
    if (batch.length < 100) break
  }
  return null
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY
  const issue = process.env.PATROL_ISSUE ?? '3087'
  const dry = process.env.PATROL_DRY_RUN === '1'
  const prs = (await gh(`/repos/${repo}/pulls?state=open&per_page=100`)).filter((p) => !p.draft)
  const items = []
  for (const pr of prs) {
    const { check_runs: runs } = await gh(`/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`)
    items.push({ number: pr.number, sha: pr.head.sha, problems: classifyPr(pr, runs) })
  }
  const existing = await findExisting(repo, issue)
  const keys = problemKeys(items)
  const decision = plan(parseState(existing?.body), keys)
  console.log(
    JSON.stringify({
      checked: items.length,
      problems: keys.length,
      added: decision.added.length,
      recovered: decision.recovered.length,
      wrote: decision.write && !dry,
    }),
  )
  if (!decision.write) return
  const body = renderBody(items, keys, decision.fp, new Date().toISOString())
  if (dry) {
    console.log(body)
    return
  }
  if (existing) await gh(`/repos/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) })
  else await gh(`/repos/${repo}/issues/${issue}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
  if (decision.added.length) {
    const mention = process.env.PATROL_MENTION ? `${process.env.PATROL_MENTION} ` : ''
    const text = `${mention}PR 巡查：新增 ${decision.added.length} 个问题：${decision.added.join('、')}（详见上方巡查状态）`
    await gh(`/repos/${repo}/issues/${issue}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) })
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
