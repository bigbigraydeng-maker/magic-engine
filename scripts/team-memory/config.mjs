/**
 * Team Working Memory — hook 侧公共配置
 *
 * 铁律：**任何一步都不许挡住 PM 干活**。
 * 网络挂了、后台 500、密钥没配 —— 一律静默放行，绝不 exit 非 0、绝不抛错到终端。
 * 这套东西的价值是长期沉淀，不值得用"卡住一次会话"来换。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export const API_BASE =
  process.env.ME_TEAM_MEMORY_URL || 'https://app.magicengine.com.au'

/** 复用 PM 全局设置里已有的 ME_CRON_SECRET，不新增要手工配的东西 */
export const SECRET = process.env.ME_CRON_SECRET || process.env.CRON_SECRET || ''

export const BUFFER_DIR = join(homedir(), '.claude', 'team-memory', 'buffer')

export function ensureBufferDir() {
  try {
    mkdirSync(BUFFER_DIR, { recursive: true })
  } catch {
    /* 建不了就算了，后面写文件会失败，同样静默 */
  }
}

export function bufferPath(sessionId) {
  return join(BUFFER_DIR, `${sessionId}.jsonl`)
}

export function metaPath(sessionId) {
  return join(BUFFER_DIR, `${sessionId}.meta.json`)
}

// ─── 项目名归一化 ───────────────────────────────────────────────────────────
// 必须跟 src/lib/team-memory/project-key.ts 保持同一套规则。
// 这是修根因的那一步：37 个 worktree 窗口全部折叠回父项目，
// 于是它们第一次能看到主目录攒下的教训。

const KNOWN_PROJECTS = ['magic-engine', 'chinatravel', 'midashand', 'magic-lab-academy']
const PROJECT_ROOT_MARKERS = ['/Projects/', '/projects/']

export function projectKeyFromCwd(cwd) {
  if (!cwd) return 'unknown'
  const path = String(cwd).replace(/\\/g, '/')

  let segment = null
  for (const marker of PROJECT_ROOT_MARKERS) {
    const idx = path.indexOf(marker)
    if (idx === -1) continue
    segment = path.slice(idx + marker.length).split('/')[0] || null
    if (segment) break
  }
  if (!segment) return 'unknown'

  if (KNOWN_PROJECTS.includes(segment)) return segment

  const prefixed = KNOWN_PROJECTS
    .filter((p) => segment.startsWith(`${p}-`))
    .sort((a, b) => b.length - a.length)[0]

  return prefixed || 'unknown'
}

export function isManaged(projectKey) {
  return projectKey !== 'unknown'
}

// ─── 小工具 ────────────────────────────────────────────────────────────────

/** 读 stdin 上的 hook JSON。读不到就返回空对象，绝不抛。 */
export async function readHookInput() {
  try {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8').trim()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

/** 在指定目录跑 git，失败返回 null —— 不是 git 仓库也不报错 */
export function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
  } catch {
    return null
  }
}

/** 带超时的 POST。任何失败都返回 null，调用方不许因此中断。 */
export async function post(path, body, timeoutMs = 8000) {
  if (!SECRET) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
