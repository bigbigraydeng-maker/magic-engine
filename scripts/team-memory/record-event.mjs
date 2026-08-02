#!/usr/bin/env node
/**
 * Team Working Memory — PostToolUse hook
 *
 * 每个工具调用触发一次，所以这里**只准做一件事：往本地文件追加一行**。
 * 不联网、不读配置文件、不算复杂逻辑。
 *
 * 为什么不直接上报：一次会话几百个工具调用，每次发 HTTP 会实打实地拖慢干活，
 * PM 会觉得 Claude Code 变卡了 —— 那这套东西第二天就会被关掉。
 * 攒在本地，会话结束时一次推走。
 */

import { appendFileSync } from 'node:fs'
import { readHookInput, ensureBufferDir, bufferPath, projectKeyFromCwd, isManaged } from './config.mjs'
import { oneLine } from './redact.mjs'

const TEST_RE = /\b(vitest|jest|npm\s+(run\s+)?test|npx\s+vitest|pytest|go\s+test)\b/i
const GIT_RE = /^\s*git\s+/i

async function main() {
  const input = await readHookInput()
  const sessionId = input.session_id
  if (!sessionId) return

  // 受管范围外的窗口（私人项目、临时目录）一个字都不记
  if (!isManaged(projectKeyFromCwd(input.cwd))) return

  const event = describe(input)
  if (!event) return

  ensureBufferDir()
  try {
    appendFileSync(bufferPath(sessionId), `${JSON.stringify(event)}\n`, 'utf8')
  } catch {
    /* 写不进去就算了，绝不影响这次工具调用 */
  }
}

function describe(input) {
  const tool = input.tool_name || ''
  const args = input.tool_input || {}
  const ok = !isFailure(input.tool_response)

  if (tool === 'Bash') {
    const cmd = String(args.command || '')
    return {
      kind: TEST_RE.test(cmd) ? 'test' : GIT_RE.test(cmd) ? 'git' : ok ? 'tool' : 'error',
      tool_name: tool,
      summary: oneLine(cmd),
      target: null,
      ok,
      occurred_at: new Date().toISOString(),
    }
  }

  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    return {
      kind: ok ? 'tool' : 'error',
      tool_name: tool,
      summary: `${tool === 'Write' ? '写入' : '修改'}文件`,
      target: oneLine(args.file_path || args.notebook_path || '', 300),
      ok,
      occurred_at: new Date().toISOString(),
    }
  }

  // 读类工具量大且信息密度低，只在失败时记 —— 失败才是教训的来源
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') {
    if (ok) return null
    return {
      kind: 'error',
      tool_name: tool,
      summary: `${tool} 失败`,
      target: oneLine(args.file_path || args.pattern || '', 300),
      ok: false,
      occurred_at: new Date().toISOString(),
    }
  }

  return {
    kind: ok ? 'tool' : 'error',
    tool_name: tool,
    summary: oneLine(summarizeArgs(args)),
    target: null,
    ok,
    occurred_at: new Date().toISOString(),
  }
}

function isFailure(response) {
  if (!response) return false
  const text = typeof response === 'string' ? response : JSON.stringify(response)
  if (/"?is_?error"?\s*[:=]\s*true/i.test(text)) return true
  return /\b(error|failed|exception|traceback|not found|permission denied)\b/i.test(text.slice(0, 400))
}

function summarizeArgs(args) {
  try {
    const s = JSON.stringify(args)
    return s.length > 300 ? `${s.slice(0, 300)}…` : s
  } catch {
    return ''
  }
}

main().catch(() => {
  /* 静默 —— hook 永远不许把 PM 的会话搞崩 */
})
