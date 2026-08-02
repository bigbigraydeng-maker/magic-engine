#!/usr/bin/env node
/**
 * Team Working Memory — 装 / 卸 hook
 *
 *   node scripts/team-memory/install.mjs              装上
 *   node scripts/team-memory/install.mjs --uninstall  卸掉
 *   node scripts/team-memory/install.mjs --dry-run    只看会改成什么样
 *
 * 改的是 ~/.claude/settings.json（全局），因为要覆盖所有窗口。
 * 动手前先备份，且**只增删自己那几条**：PM 已有的 `gh pr merge` 确认闸门
 * 必须原样留着 —— 那是 CLAUDE.md 里三层防御的第二层，碰掉了是事故。
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SETTINGS = join(homedir(), '.claude', 'settings.json')
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * hook 实际执行的是 ~/.claude 下的**副本**，不是仓库里的文件。
 *
 * 为什么：hook 是全局的，会在所有窗口触发，而不同窗口停在不同分支上。
 * 如果直接指向仓库路径，某个窗口切到还没有这套脚本的分支时，文件就不存在了 ——
 * 而 hook 的设计是静默失败，所以管子会**悄悄断掉且没人发现**。
 * 拷一份出来，跟 git 状态彻底脱钩。改了脚本重跑一次 install 即可同步。
 */
const BIN_DIR = join(homedir(), '.claude', 'team-memory', 'bin')
const SCRIPT_FILES = [
  'config.mjs',
  'redact.mjs',
  'session-start.mjs',
  'record-event.mjs',
  'session-end.mjs',
]

/** 认领标记：只有 command 里含这个的条目才是我们的，卸载时只删这些 */
const MARKER = 'team-memory'

const UNINSTALL = process.argv.includes('--uninstall')
const DRY_RUN = process.argv.includes('--dry-run')

/** 把脚本拷进 ~/.claude/team-memory/bin，返回拷了几个 */
function syncScripts() {
  mkdirSync(BIN_DIR, { recursive: true })
  let n = 0
  for (const f of SCRIPT_FILES) {
    const src = resolve(SCRIPT_DIR, f)
    if (!existsSync(src)) {
      console.error(`缺文件：${src}（安装中止，免得装出一个半截的管子）`)
      process.exit(1)
    }
    copyFileSync(src, join(BIN_DIR, f))
    n += 1
  }
  return n
}

function ourHooks() {
  const node = process.execPath
  const s = (f, args = '') => `${node} ${join(BIN_DIR, f)}${args ? ` ${args}` : ''}`
  return {
    SessionStart: {
      hooks: [{ type: 'command', command: s('session-start.mjs') }],
    },
    PostToolUse: {
      matcher: '*',
      hooks: [{ type: 'command', command: s('record-event.mjs') }],
    },
    Stop: {
      hooks: [{ type: 'command', command: s('session-end.mjs') }],
    },
    SessionEnd: {
      hooks: [{ type: 'command', command: s('session-end.mjs', '--final') }],
    },
  }
}

function isOurs(entry) {
  return (entry?.hooks ?? []).some((h) => String(h?.command ?? '').includes(MARKER))
}

function main() {
  const settings = readSettings()
  settings.hooks = settings.hooks ?? {}

  const ours = ourHooks()
  const touched = []

  for (const event of Object.keys(ours)) {
    const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : []
    // 先剔掉我们自己的旧条目（重装时避免堆积），别人的原样保留
    const kept = existing.filter((e) => !isOurs(e))

    if (UNINSTALL) {
      if (kept.length !== existing.length) touched.push(`${event}: 已移除`)
      if (kept.length === 0) delete settings.hooks[event]
      else settings.hooks[event] = kept
      continue
    }

    settings.hooks[event] = [...kept, ours[event]]
    touched.push(`${event}: 已装上（保留了原有 ${kept.length} 条）`)
  }

  if (DRY_RUN) {
    console.log(JSON.stringify(settings.hooks, null, 2))
    console.log('\n--dry-run：没有写入任何文件')
    return
  }

  backup()
  if (!UNINSTALL) {
    const n = syncScripts()
    console.log(`已把 ${n} 个脚本拷到 ${BIN_DIR}（hook 跑的是这份副本，跟分支无关）`)
  }
  writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')

  console.log(UNINSTALL ? '已卸载：' : '已安装：')
  touched.forEach((t) => console.log(`  - ${t}`))
  console.log(`\n配置文件：${SETTINGS}`)
  if (!UNINSTALL) {
    console.log('生效范围：magic-engine / chinatravel / midashand / magic-lab-academy 及其全部 worktree')
    console.log('其它目录的窗口一个字都不会上报。')
  }
}

function readSettings() {
  if (!existsSync(SETTINGS)) return {}
  try {
    return JSON.parse(readFileSync(SETTINGS, 'utf8'))
  } catch (err) {
    console.error(`读不动 ${SETTINGS}，先修好它再装：${err.message}`)
    process.exit(1)
  }
}

function backup() {
  if (!existsSync(SETTINGS)) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = `${SETTINGS}.bak-${stamp}`
  copyFileSync(SETTINGS, dest)
  console.log(`已备份原配置到 ${dest}`)
}

main()
