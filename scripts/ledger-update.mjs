// 无人值守的夜巡任务不能用编辑器工具改文件：没有交互界面，也没人盯着格式。
// 任何窗口 / Codex / 同事改卡也该走同一个入口，免得手抖写坏 frontmatter。
// 这个脚本只做一件事：给一张 ledger 卡片的 frontmatter 打补丁，正文原样不动。
// 冻结字段（id/title/decided_on/source/verify_by/verify_how）默认拒绝修改，
// 需要时用 --allow-frozen 显式放行，让改动留下痕迹。
// 用法示例：
//   node scripts/ledger-update.mjs 2026-09-24-harness-ledger-v0 status=done done_on=2026-09-25 done_ref=pr:1984
//   node scripts/ledger-update.mjs <id> last_checked=2026-09-27 'check_note=PR 还没合并'

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FROZEN_KEYS = ['id', 'title', 'decided_on', 'source', 'verify_by', 'verify_how']
export const ALLOWED_KEYS = ['status', 'owner', 'done_on', 'done_ref', 'verified_ref', 'last_checked', 'check_note']

/**
 * 纯函数：给一份卡片全文应用 key=value 更新，返回新全文。
 * @param {string} text
 * @param {Array<[string, string]>} updates
 * @param {{ allowFrozen?: boolean }} [opts]
 * @returns {string}
 */
export function applyUpdates(text, updates, { allowFrozen = false } = {}) {
  const normalised = text.replace(/\r\n/g, '\n')
  if (!normalised.startsWith('---\n')) throw new Error('缺少文件头')
  const closeIdx = normalised.indexOf('\n---', 4)
  if (closeIdx === -1) throw new Error('缺少文件头')

  const head = normalised.slice(0, closeIdx + 1)
  const tail = normalised.slice(closeIdx + 1)
  let lines = head.split('\n')

  for (const [key, value] of updates) {
    if (FROZEN_KEYS.includes(key) && !allowFrozen) throw new Error(`${key} 是冻结字段，不许改`)
    if (!ALLOWED_KEYS.includes(key) && !FROZEN_KEYS.includes(key)) throw new Error(`不认识的字段 ${key}`)
    lines = applyOne(lines, key, value)
  }

  return lines.join('\n') + tail
}

/**
 * 在 frontmatter 行数组里替换 / 追加 / 删除一行。
 * @param {string[]} lines
 * @param {string} key
 * @param {string} value
 * @returns {string[]}
 */
function applyOne(lines, key, value) {
  const idx = lines.findIndex((line) => line.startsWith(`${key}:`))
  if (value === '') {
    if (idx !== -1) lines.splice(idx, 1)
    return lines
  }
  const next = `${key}: ${value}`
  if (idx !== -1) lines[idx] = next
  else lines.splice(lines.length - 1, 0, next)
  return lines
}

/**
 * 解析 argv，返回 id、更新对与 allowFrozen。
 * @param {string[]} argv
 * @returns {{ id: string | undefined, pairs: Array<[string, string]>, allowFrozen: boolean }}
 */
function parseArgs(argv) {
  let allowFrozen = false
  const rest = []
  for (const arg of argv) {
    if (arg === '--allow-frozen') allowFrozen = true
    else rest.push(arg)
  }
  const [id, ...rawPairs] = rest
  const pairs = rawPairs.map((pair) => {
    const eq = pair.indexOf('=')
    return eq === -1 ? [pair, ''] : [pair.slice(0, eq), pair.slice(eq + 1)]
  })
  return { id, pairs, allowFrozen }
}

function main() {
  const { id, pairs, allowFrozen } = parseArgs(process.argv.slice(2))
  if (!id || pairs.length === 0) {
    process.stderr.write('用法: node scripts/ledger-update.mjs <id> key=value [key=value ...] [--allow-frozen]\n')
    process.exit(2)
  }
  const path = resolve(process.cwd(), 'docs/ledger', `${id}.md`)
  if (!existsSync(path)) {
    process.stderr.write(`找不到 ${path}\n`)
    process.exit(1)
  }
  try {
    const updated = applyUpdates(readFileSync(path, 'utf8'), pairs, { allowFrozen })
    writeFileSync(path, updated)
    process.stdout.write(`updated ${path}: ${pairs.map(([k]) => k).join(', ')}\n`)
    process.exit(0)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
