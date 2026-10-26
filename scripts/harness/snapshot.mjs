// 只读 dev-console 快照的 I/O 层：把会话列表、gh 输出、brief 文本、ledger 卡片拼成快照模型，
// 再交给 snapshot-render.mjs 渲染。所有 I/O 都通过注入的函数完成，测试不需要真网络、真磁盘。
// 这个脚本唯一会写的东西是 --out-dir 里的文件；它从不 commit、push，也不调用 GitHub 的任何写接口。
// 风格与 snapshot-core.mjs / ledger-update.mjs 保持一致：ESM、具名导出、JSDoc 类型、2 空格缩进、无分号、单引号。

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  attachOwners,
  computeDots,
  findCollisions,
  parseCardFrontmatter,
  pickActiveWindows,
  riskFromComments,
  splitCollisions,
  suggestArchive,
  worstCardState,
} from './snapshot-core.mjs'
import { renderHtml } from './snapshot-render.mjs'

export const GH_FETCH_LIMIT = 300
export const LOCK_FRESH_MS = 10 * 60 * 1000

const USAGE = '用法：node scripts/harness/snapshot.mjs --sessions <会话列表.json> --out-dir <输出目录> [--force]'

const ERR_PR_LIST = 'GitHub 开着的 PR 列表没取到，撞车检查是空的，不代表没有撞车'
const ERR_PR_OVER_LIMIT = 'GitHub 开着的 PR 超过 300 个，撞车检查只看了前 300 个'
const ERR_PR_DETAIL = 'GitHub 部分 PR 的详情没取到，这些窗口的灯可能偏空'

/**
 * 从 gh 的 files 列表里挑出 ledger 卡片路径，排除 README 和嵌套目录。
 * @param {Array<{ path: string }>} files
 * @returns {string[]}
 */
export function ledgerCardPaths(files) {
  if (!Array.isArray(files)) return []
  const result = []
  for (const entry of files) {
    const path = entry && typeof entry.path === 'string' ? entry.path : null
    if (path === null) continue
    if (!/^docs\/ledger\/[^/]+\.md$/.test(path)) continue
    if (path === 'docs/ledger/README.md') continue
    result.push(path)
  }
  return result
}

/**
 * 从 statusCheckRollup 里读 'Risk gate' 的结论。
 * @param {Array<{ name?: string, status?: string, conclusion?: string, context?: string, state?: string }> | undefined} rollup
 * @returns {'success' | 'failure' | 'pending' | 'unknown'}
 */
export function riskGateFromRollup(rollup) {
  if (!Array.isArray(rollup)) return 'unknown'
  const item = rollup.find((entry) => {
    if (!entry || typeof entry !== 'object') return false
    return entry.name === 'Risk gate' || entry.context === 'Risk gate'
  })
  if (!item) return 'unknown'

  const conclusion = typeof item.conclusion === 'string' ? item.conclusion.toUpperCase() : ''
  const state = typeof item.state === 'string' ? item.state.toUpperCase() : ''

  if (conclusion === 'FAILURE' || conclusion === 'TIMED_OUT' || conclusion === 'CANCELLED') return 'failure'
  if (state === 'FAILURE' || state === 'ERROR') return 'failure'
  if (conclusion === 'SUCCESS' || state === 'SUCCESS') return 'success'
  return 'pending'
}

/**
 * 把会话、gh 输出、brief 文本、ledger 卡片拼成快照模型。
 * @param {{
 *   sessions: Array<{ sessionId: string, title: string, branch?: string, prNumber?: number, prState?: 'OPEN'|'MERGED'|'CLOSED', lastActivityAt: string, group?: { name: string } | null, isArchived?: boolean }>,
 *   nowIso: string,
 *   today: string,
 *   runGh: (args: string[]) => string,
 *   readLedgerCard: (path: string) => string | null,
 * }} deps
 * @returns {{
 *   generatedAt: string,
 *   today: string,
 *   windows: Array<{ number: string|null, group: string, title: string, branch: string, risk: 'A'|'B'|'C'|'?', prNumber: number|null, prState: 'OPEN'|'MERGED'|'CLOSED'|null, lastActivityAt: string, dots: { opened: 'ok'|'warn'|'bad'|'none', merged: 'ok'|'warn'|'bad'|'none', verified: 'ok'|'warn'|'bad'|'none' } }>,
 *   inactiveCount: number,
 *   collisions: Array<{ file: string, prs: Array<{ number: number, headRefName: string, window: string|null }> }>,
 *   collisionsOtherCount: number,
 *   archiveSuggestions: Array<{ id: string, number: string|null, group: string, lastActivityAt: string }>,
 *   errors: string[],
 * }}
 */
export function buildSnapshot(deps) {
  const { active, inactiveCount } = pickActiveWindows(deps.sessions, deps.nowIso, 3)
  /** @type {string[]} */
  const errors = []

  // 开着的 PR 列表 -> 撞车
  /** @type {Array<{ number: number, headRefName: string, files?: Array<{ path: string }> }>} */
  let openPrs = []
  try {
    const raw = deps.runGh(['pr', 'list', '--state', 'open', '--limit', String(GH_FETCH_LIMIT), '--json', 'number,title,headRefName,files'])
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      openPrs = parsed
      if (parsed.length === GH_FETCH_LIMIT) errors.push(ERR_PR_OVER_LIMIT)
    } else {
      errors.push(ERR_PR_LIST)
    }
  } catch {
    errors.push(ERR_PR_LIST)
  }

  const { relevant: collisions, otherCount: collisionsOtherCount } = splitCollisions(
    attachOwners(findCollisions(openPrs), active),
  )

  // 每个有 PR 的活跃窗口 -> 风险灯 / 验证灯
  let detailFailed = false
  const windows = active.map((win) => {
    let riskGate = 'unknown'
    let cardState = 'none'
    let risk = '?'

    if (win.prNumber !== null && win.prNumber !== undefined) {
      try {
        const raw = deps.runGh([
          'pr',
          'view',
          String(win.prNumber),
          '--json',
          'files,statusCheckRollup,comments,headRefOid',
        ])
        const detail = JSON.parse(raw)
        riskGate = win.prState === 'OPEN' ? riskGateFromRollup(detail && detail.statusCheckRollup) : 'unknown'
        risk = riskFromComments(detail && detail.comments, detail && detail.headRefOid)

        if (win.prState === 'MERGED') {
          const paths = ledgerCardPaths(detail && detail.files)
          /** @type {Array<{ status: string | null, verifyBy: string | null }>} */
          const cards = []
          for (const path of paths) {
            const text = deps.readLedgerCard(path)
            if (text === null || text === undefined) continue
            const parsed = parseCardFrontmatter(text)
            cards.push({ status: parsed.status, verifyBy: parsed.verifyBy })
          }
          cardState = worstCardState(cards, deps.today)
        }
      } catch {
        riskGate = 'unknown'
        cardState = 'none'
        risk = '?'
        detailFailed = true
      }
    }

    const dots = computeDots({
      prNumber: win.prNumber,
      prState: win.prState,
      riskGate,
      cardState,
    })

    return {
      number: win.number,
      group: win.group,
      title: win.title,
      branch: win.branch,
      risk,
      prNumber: win.prNumber,
      prState: win.prState,
      lastActivityAt: win.lastActivityAt,
      dots,
    }
  })

  if (detailFailed) errors.push(ERR_PR_DETAIL)

  const archiveSuggestions = suggestArchive(deps.sessions, deps.nowIso, 3)

  return {
    generatedAt: deps.nowIso,
    today: deps.today,
    windows,
    inactiveCount,
    collisions,
    collisionsOtherCount,
    archiveSuggestions,
    errors,
  }
}

/**
 * 锁文件是否新鲜：能解析成时间，且 0 <= nowMs - time < LOCK_FRESH_MS。
 * @param {string | null} lockText
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isFresh(lockText, nowMs) {
  if (typeof lockText !== 'string') return false
  const at = Date.parse(lockText.trim())
  if (!Number.isFinite(at)) return false
  const delta = nowMs - at
  return delta >= 0 && delta < LOCK_FRESH_MS
}

/**
 * 解析 argv（process.argv.slice(2)）。
 * @param {string[]} argv
 * @returns {{ sessions: string | null, outDir: string | null, today: string | null, now: string | null, force: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ sessions: string | null, outDir: string | null, today: string | null, now: string | null, force: boolean }} */
  const result = { sessions: null, outDir: null, today: null, now: null, force: false }
  const list = Array.isArray(argv) ? argv : []

  for (let i = 0; i < list.length; i += 1) {
    const flag = list[i]
    if (flag === '--force') {
      result.force = true
      continue
    }
    if (flag === '--sessions' || flag === '--out-dir' || flag === '--today' || flag === '--now') {
      const value = list[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 缺少值`)
      i += 1
      if (flag === '--sessions') result.sessions = value
      else if (flag === '--out-dir') result.outDir = value
      else if (flag === '--today') result.today = value
      else result.now = value
      continue
    }
    throw new Error(`不认识的参数 ${flag}`)
  }

  return result
}

/**
 * 把 ISO 时间转成 Pacific/Auckland 的 'YYYY-MM-DD'。
 * @param {string} iso
 * @returns {string}
 */
function aucklandDate(iso) {
  const at = Date.parse(iso)
  const date = Number.isFinite(at) ? new Date(at) : new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const pick = (type) => {
    const found = parts.find((part) => part.type === type)
    return found ? found.value : ''
  }
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

/**
 * CLI 入口：返回退出码（0/1/2），从不调用 process.exit。
 * @param {string[]} argv
 * @param {{
 *   readFile: (path: string) => string,
 *   writeFile: (path: string, text: string) => void,
 *   exists: (path: string) => boolean,
 *   mkdirp: (path: string) => void,
 *   runGh: (args: string[]) => string,
 *   now: () => number,
 *   log: (text: string) => void,
 *   repoRoot: string,
 * }} io
 * @returns {number}
 */
export function runCli(argv, io) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    io.log(err instanceof Error ? err.message : String(err))
    return 1
  }

  if (!args.sessions || !args.outDir) {
    io.log(USAGE)
    return 1
  }

  const outDir = args.outDir
  io.mkdirp(outDir)

  const lockPath = `${outDir}/.snapshot.lock`
  const snapshotPath = `${outDir}/snapshot.json`

  if (!args.force && io.exists(lockPath) && io.exists(snapshotPath)) {
    let lockText = null
    try {
      lockText = io.readFile(lockPath)
    } catch {
      lockText = null
    }
    if (isFresh(lockText, io.now())) {
      let previous = null
      try {
        previous = JSON.parse(io.readFile(snapshotPath))
      } catch {
        previous = null
      }
      if (previous !== null && typeof previous === 'object') {
        io.log('10 分钟内已经跑过，沿用上一份结果')
        const previousErrors = /** @type {{ errors?: unknown }} */ (previous).errors
        if (Array.isArray(previousErrors) && previousErrors.length > 0) {
          io.log('上一份结果里有数据没取到，页面上已标红')
          return 2
        }
        return 0
      }
    }
  }

  let sessionsText
  try {
    sessionsText = io.readFile(args.sessions)
  } catch {
    io.log('会话列表文件格式不对')
    return 1
  }

  /** @type {unknown} */
  let parsedSessions
  try {
    parsedSessions = JSON.parse(sessionsText)
  } catch {
    io.log('会话列表文件格式不对')
    return 1
  }

  /** @type {Array<{ sessionId: string, title: string, branch?: string, prNumber?: number, prState?: 'OPEN'|'MERGED'|'CLOSED', lastActivityAt: string, group?: { name: string } | null, isArchived?: boolean }>} */
  let sessions
  if (Array.isArray(parsedSessions)) {
    sessions = parsedSessions
  } else if (
    parsedSessions !== null &&
    typeof parsedSessions === 'object' &&
    Array.isArray(/** @type {{ sessions?: unknown }} */ (parsedSessions).sessions)
  ) {
    sessions = /** @type {{ sessions: Array<{ sessionId: string, title: string, branch?: string, prNumber?: number, prState?: 'OPEN'|'MERGED'|'CLOSED', lastActivityAt: string, group?: { name: string } | null, isArchived?: boolean }> }} */ (parsedSessions).sessions
  } else {
    io.log('会话列表文件格式不对')
    return 1
  }

  const nowIso = args.now ?? new Date(io.now()).toISOString()
  const today = args.today ?? aucklandDate(nowIso)

  const readLedgerCard = (path) => {
    try {
      return io.readFile(`${io.repoRoot}/${path}`)
    } catch {
      return null
    }
  }

  const model = buildSnapshot({
    sessions,
    nowIso,
    today,
    runGh: io.runGh,
    readLedgerCard,
  })

  io.writeFile(snapshotPath, JSON.stringify(model, null, 2))
  io.writeFile(`${outDir}/snapshot-full.html`, renderHtml(model, 'full'))
  io.writeFile(`${outDir}/snapshot-mobile.html`, renderHtml(model, 'mobile'))
  io.writeFile(lockPath, nowIso)

  io.log(`窗口 ${model.windows.length} 个，撞车 ${model.collisions.length} 处，建议归档 ${model.archiveSuggestions.length} 个`)

  if (model.errors.length > 0) {
    io.log('有数据没取到，页面上已标红')
    return 2
  }
  return 0
}

/**
 * 判断当前模块是不是被直接执行（而不是被 import）。
 * 用 realpathSync 比较真实路径，这样通过软链接启动也能正确识别。
 * realpathSync 抛错时返回 false。
 * @returns {boolean}
 */
export function isMain() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

function main() {
  const repoRoot = process.cwd()
  const io = {
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, text) => writeFileSync(path, text),
    exists: (path) => existsSync(path),
    mkdirp: (path) => mkdirSync(path, { recursive: true }),
    runGh: (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }),
    now: () => Date.now(),
    log: (text) => process.stdout.write(`${text}\n`),
    repoRoot,
  }
  process.exit(runCli(process.argv.slice(2), io))
}

if (isMain()) main()
