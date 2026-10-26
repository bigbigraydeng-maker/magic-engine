// 只读 dev-console 快照的纯函数集合：不碰文件、不碰网络、不读时钟、不读 process.env。
// 所有输入都通过参数传入，所有输出都是普通数据，方便在测试里直接断言。
// 风格与 scripts/ledger-update.mjs 保持一致：ESM、具名导出、JSDoc 类型、2 空格缩进、无分号、单引号。

export const IGNORED_COLLISION_PREFIXES = ['docs/ledger/']
export const IGNORED_COLLISION_FILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'docs/history/CHANGELOG.md',
]

/**
 * 从标题里取开头的窗口号，取不到返回 null。
 * 只认标题最开头的 1~3 位数字，后面必须紧跟 '-'、空白、'号' 或 '·'。
 * @param {string} title
 * @returns {string | null}
 */
export function windowNumber(title) {
  if (typeof title !== 'string') return null
  const match = title.trim().match(/^(\d{1,3})(?=[-\s号·])/)
  return match ? match[1] : null
}

/**
 * 挑出活跃窗口，其余计入 inactiveCount。
 * 活跃条件：lastActivityAt 在 nowIso 往前 days 天内，branch 是非空字符串且不是 main/master。
 * @param {Array<{ sessionId: string, title: string, branch?: string, prNumber?: number, prState?: 'OPEN'|'MERGED'|'CLOSED', lastActivityAt: string, group?: { name: string } | null }>} sessions
 * @param {string} nowIso
 * @param {number} [days]
 * @returns {{ active: Array<{ id: string, number: string | null, group: string, title: string, branch: string, prNumber: number | null, prState: 'OPEN'|'MERGED'|'CLOSED' | null, lastActivityAt: string }>, inactiveCount: number }}
 */
export function pickActiveWindows(sessions, nowIso, days = 3) {
  const now = Date.parse(nowIso)
  const windowMs = days * 24 * 60 * 60 * 1000
  const active = []
  let inactiveCount = 0

  for (const session of sessions) {
    const at = Date.parse(session.lastActivityAt)
    const branch = session.branch
    const fresh = Number.isFinite(now) && Number.isFinite(at) && now - at <= windowMs
    const hasBranch = typeof branch === 'string' && branch.length > 0
    const notMain = branch !== 'main' && branch !== 'master'

    if (fresh && hasBranch && notMain) {
      active.push({
        id: session.sessionId,
        number: windowNumber(session.title),
        group: session.group?.name ?? '未分组',
        title: session.title,
        branch,
        prNumber: Number.isInteger(session.prNumber) && session.prNumber > 0 ? session.prNumber : null,
        prState: session.prState ?? null,
        lastActivityAt: session.lastActivityAt,
      })
    } else {
      inactiveCount += 1
    }
  }

  active.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
  return { active, inactiveCount }
}

const GATE_MARKER = /<!--\s*me-dev-gate:(\{.*?\})\s*-->/s
const GATE_AUTHORS = ['github-actions', 'github-actions[bot]']

/**
 * 从 PR 评论里读合并闸的风险级，只认 A/B/C，其余一律 '?'。
 * 只认 github-actions 机器人发的、带 me-dev-gate 标记的评论；
 * headSha 必填，只认 head 完全相等的标记，取最后一条。
 * @param {Array<{ author?: { login?: string }, body?: string }>} comments
 * @param {string} headSha
 * @returns {'A' | 'B' | 'C' | '?'}
 */
export function riskFromComments(comments, headSha) {
  if (typeof headSha !== 'string' || headSha.length === 0) return '?'
  if (!Array.isArray(comments)) return '?'
  const wantHead = headSha
  let risk = '?'

  for (const comment of comments) {
    const login = comment?.author?.login
    if (!GATE_AUTHORS.includes(login)) continue
    const body = comment?.body
    if (typeof body !== 'string') continue
    const match = body.match(GATE_MARKER)
    if (!match) continue
    let marker
    try {
      marker = JSON.parse(match[1])
    } catch {
      continue
    }
    if (!marker || typeof marker !== 'object') continue
    if (marker.head !== wantHead) continue
    risk = marker.risk === 'A' || marker.risk === 'B' || marker.risk === 'C' ? marker.risk : '?'
  }

  return risk
}

/**
 * 极简 frontmatter 解析：只取 id / status / verify_by。
 * 不是以 '---\n' 开头就全部返回 null。
 * @param {string} cardText
 * @returns {{ id: string | null, status: string | null, verifyBy: string | null }}
 */
export function parseCardFrontmatter(cardText) {
  const result = { id: null, status: null, verifyBy: null }
  if (typeof cardText !== 'string') return result

  const normalised = cardText.replace(/\r\n/g, '\n')
  if (!normalised.startsWith('---\n')) return result

  const lines = normalised.split('\n')
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === '---') break
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    value = value.replace(/\s{2,}#.*$/, '').trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    if (key === 'id') result.id = value
    else if (key === 'status') result.status = value
    else if (key === 'verify_by') result.verifyBy = value
  }
  return result
}

/**
 * 汇总一组卡片的整体状态，优先级 failed > due > ok > pending。
 * @param {Array<{ status: string | null, verifyBy: string | null }>} cards
 * @param {string} today 'YYYY-MM-DD'
 * @returns {'none' | 'failed' | 'due' | 'pending' | 'ok'}
 */
export function worstCardState(cards, today) {
  if (!Array.isArray(cards) || cards.length === 0) return 'none'
  if (cards.some((card) => card.status === 'failed')) return 'failed'
  if (cards.some((card) => card.status === 'done' && typeof card.verifyBy === 'string' && card.verifyBy <= today)) {
    return 'due'
  }
  if (cards.every((card) => card.status === 'verified')) return 'ok'
  return 'pending'
}

/**
 * 计算三个状态灯：opened / merged / verified。
 * @param {{ prNumber?: number | null, prState?: 'OPEN'|'MERGED'|'CLOSED' | null, riskGate?: string | null, cardState?: 'none'|'failed'|'due'|'pending'|'ok' | null }} input
 * @returns {{ opened: 'ok'|'warn'|'bad'|'none', merged: 'ok'|'warn'|'bad'|'none', verified: 'ok'|'warn'|'bad'|'none' }}
 */
export function computeDots({ prNumber, prState, riskGate, cardState }) {
  let opened = 'none'
  if (prNumber !== null && prNumber !== undefined) {
    opened = riskGate === 'failure' ? 'warn' : 'ok'
  }

  const merged = prState === 'MERGED' ? 'ok' : 'none'

  let verified = 'none'
  if (prNumber !== null && prNumber !== undefined && prState === 'MERGED') {
    if (cardState === 'ok') verified = 'ok'
    else if (cardState === 'failed') verified = 'bad'
    else if (cardState === 'due') verified = 'warn'
    else if (cardState === 'pending') verified = 'warn'
    else verified = 'none'
  }

  return { opened, merged, verified }
}

/**
 * 找出被两个及以上不同 open PR 同时改到的文件。
 * @param {Array<{ number: number, headRefName: string, files?: Array<{ path: string }> }>} openPrs
 * @returns {Array<{ file: string, prs: Array<{ number: number, headRefName: string }> }>}
 */
export function findCollisions(openPrs) {
  /** @type {Map<string, Map<number, { number: number, headRefName: string }>>} */
  const byFile = new Map()

  for (const pr of openPrs) {
    const files = Array.isArray(pr.files) ? pr.files : []
    const seen = new Set()
    for (const entry of files) {
      const path = entry.path
      if (typeof path !== 'string') continue
      if (seen.has(path)) continue
      seen.add(path)
      if (IGNORED_COLLISION_FILES.includes(path)) continue
      if (IGNORED_COLLISION_PREFIXES.some((prefix) => path.startsWith(prefix))) continue
      let prs = byFile.get(path)
      if (!prs) {
        prs = new Map()
        byFile.set(path, prs)
      }
      prs.set(pr.number, { number: pr.number, headRefName: pr.headRefName })
    }
  }

  const collisions = []
  for (const [file, prs] of byFile) {
    if (prs.size < 2) continue
    const list = Array.from(prs.values()).sort((a, b) => a.number - b.number)
    collisions.push({ file, prs: list })
  }

  collisions.sort((a, b) => {
    if (b.prs.length !== a.prs.length) return b.prs.length - a.prs.length
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0
  })
  return collisions
}

/**
 * 给每个冲突 PR 挂上对应窗口号（按 branch 匹配），返回新对象，不改输入。
 * 同分支有带编号的窗口就用编号；只有无编号窗口时用 '无编号'；没有窗口才是 null。
 * @param {Array<{ file: string, prs: Array<{ number: number, headRefName: string }> }>} collisions
 * @param {Array<{ number: string | null, branch: string }>} windows
 * @returns {Array<{ file: string, prs: Array<{ number: number, headRefName: string, window: string | null }> }>}
 */
export function attachOwners(collisions, windows) {
  return collisions.map((collision) => ({
    file: collision.file,
    prs: collision.prs.map((pr) => {
      const sameBranch = windows.filter((win) => win.branch === pr.headRefName)
      const numbered = sameBranch.find((win) => win.number !== null)
      let window = null
      if (numbered) window = numbered.number
      else if (sameBranch.length > 0) window = '无编号'
      return { number: pr.number, headRefName: pr.headRefName, window }
    }),
  }))
}

/**
 * 把冲突分成「和活跃窗口有关」和「其余」两组，保持原顺序和原对象。
 * @param {Array<{ file: string, prs: Array<{ number: number, headRefName: string, window: string | null }> }>} collisions
 * @returns {{ relevant: Array<{ file: string, prs: Array<{ number: number, headRefName: string, window: string | null }> }>, otherCount: number }}
 */
export function splitCollisions(collisions) {
  if (!Array.isArray(collisions)) return { relevant: [], otherCount: 0 }
  const relevant = []
  let otherCount = 0
  for (const collision of collisions) {
    const prs = Array.isArray(collision?.prs) ? collision.prs : []
    if (prs.some((pr) => pr.window !== null && pr.window !== undefined)) {
      relevant.push(collision)
    } else {
      otherCount += 1
    }
  }
  return { relevant, otherCount }
}

/**
 * 找出可以归档的会话：PR 已合并，且最后活动时间早于 nowIso 往前 days 天，且未归档。
 * @param {Array<{ sessionId: string, title: string, prState?: 'OPEN'|'MERGED'|'CLOSED', lastActivityAt: string, group?: { name: string } | null, isArchived?: boolean }>} sessions
 * @param {string} nowIso
 * @param {number} [days]
 * @returns {Array<{ id: string, number: string | null, group: string, lastActivityAt: string }>}
 */
export function suggestArchive(sessions, nowIso, days = 3) {
  const now = Date.parse(nowIso)
  const windowMs = days * 24 * 60 * 60 * 1000
  const result = []

  for (const session of sessions) {
    if (session.prState !== 'MERGED') continue
    if (session.isArchived === true) continue
    const at = Date.parse(session.lastActivityAt)
    if (!Number.isFinite(now) || !Number.isFinite(at)) continue
    if (now - at <= windowMs) continue
    result.push({
      id: session.sessionId,
      number: windowNumber(session.title),
      group: session.group?.name ?? '未分组',
      lastActivityAt: session.lastActivityAt,
    })
  }

  result.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
  return result
}
