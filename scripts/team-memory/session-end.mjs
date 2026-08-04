#!/usr/bin/env node
/**
 * Team Working Memory — 冲刷 hook，两档
 *
 *   无参数（挂 Stop）      每轮回答结束冲刷一次，防止窗口被强杀时丢数据。
 *                          只落库，不提炼、不清缓冲。
 *   --final（挂 SessionEnd）真正结束：标记结束 + 触发提炼 + 清本地缓冲。
 *
 * 为什么分两档：Stop 每轮都触发，如果每次都调 AI 提炼，一天几百次，纯烧钱。
 * 但完全不在 Stop 冲刷，窗口被 kill 掉这一整段就全丢了。
 *
 * 算出的几个**机器可验证**的结果信号（改了哪些文件、跑没跑测试、产生了哪些
 * commit、PM 当场纠正了我几次），就是「硬证据闸门」的全部输入。
 * 见 src/lib/team-memory/evidence.ts。
 *
 * 静默哲学：推不上去就把本地缓冲留着，下次再带走。
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import {
  readHookInput,
  bufferPath,
  metaPath,
  projectKeyFromCwd,
  isManaged,
  git,
  post,
} from './config.mjs'
import { redact, oneLine } from './redact.mjs'

/** PM 当场纠正我的说法。宁可少认，也不要把普通提问算成纠正。 */
const CORRECTION_RE =
  /(不对|错了|搞错|不是这样|我没说|我说过|别这么|不要这么|停一下|重来|你又|revert|撤回|回滚)/

const IS_FINAL = process.argv.includes('--final')

async function main() {
  const input = await readHookInput()
  const sessionId = input.session_id
  if (!sessionId) return

  const meta = readMeta(sessionId)
  const cwd = meta?.cwd || input.cwd || process.cwd()
  const projectKey = meta?.project_key || projectKeyFromCwd(cwd)
  if (!isManaged(projectKey)) return

  const events = readBuffer(sessionId)
  const transcript = readTranscript(meta?.transcript_path || input.transcript_path)
  // 结果信号要看**全部**事件（比如测试是第 3 轮跑的，不能因为已经报过就漏掉）
  const derived = derive(events, cwd, meta)

  // 但事件本身只推新的。Stop 每轮都触发，每次重推全部会让第 50 轮传 500 条老数据。
  const flushedUpto = Number(meta?.flushed_upto ?? 0)
  const fresh = events.filter((e) => e.seq > flushedUpto)

  const payload = {
    session_key: sessionId,
    project_key: projectKey,
    cwd,
    git_branch: meta?.git_branch ?? git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git_head: git(cwd, ['rev-parse', 'HEAD']),
    goal: transcript.goal,
    status: IS_FINAL ? 'ended' : 'active',
    started_at: meta?.started_at ?? null,
    ended_at: IS_FINAL ? new Date().toISOString() : null,
    user_corrections: transcript.corrections,
    events: fresh,
    ...derived,
    commit_verdicts: meta?.commit_verdicts ?? [],
  }

  // 每轮冲刷给 5 秒，别拖住 PM 看回答；真结束时给足 15 秒
  const res = await post('/api/team-memory/ingest', payload, IS_FINAL ? 15000 : 5000)
  if (!res) return // 推不上去：缓冲留着，下次再说

  if (!IS_FINAL) {
    // 中途冲刷到此为止：不提炼、不清缓冲，只记住推到哪了
    const lastSeq = fresh.length > 0 ? fresh[fresh.length - 1].seq : flushedUpto
    writeMeta(sessionId, { ...(meta ?? {}), flushed_upto: lastSeq })
    return
  }

  clearBuffer(sessionId)

  // 提炼打一枪就走，不等结果。打不中的由 cron sweeper 兜底。
  await post('/api/team-memory/distill', { session_key: sessionId }, 2000)
}

// ─── 从事件流里算出结果信号 ────────────────────────────────────────────────

function derive(events, cwd, meta) {
  const files = new Set()
  let commands = 0
  let testsPassed = null
  let testsFailed = null

  for (const e of events) {
    if ((e.tool_name === 'Edit' || e.tool_name === 'Write') && e.target) files.add(e.target)
    if (e.tool_name === 'Bash') commands += 1
    if (e.kind === 'test') {
      if (e.ok === false) testsFailed = true
      else testsPassed = true
    }
  }

  return {
    files_changed: [...files].slice(0, 200),
    commands_run: commands,
    tests_passed: testsPassed,
    tests_failed: testsFailed,
    commit_shas: commitsSince(cwd, meta?.git_head),
  }
}

/** 本次会话新产生的 commit。拿不到就返回空 —— 空比编造好。 */
function commitsSince(cwd, startHead) {
  if (!startHead) return []
  const out = git(cwd, ['rev-list', `${startHead}..HEAD`])
  if (!out) return []
  return out.split('\n').filter(Boolean).slice(0, 50)
}

// ─── 读本地文件 ────────────────────────────────────────────────────────────

function readMeta(sessionId) {
  try {
    return JSON.parse(readFileSync(metaPath(sessionId), 'utf8'))
  } catch {
    return null
  }
}

function writeMeta(sessionId, meta) {
  try {
    writeFileSync(metaPath(sessionId), JSON.stringify(meta), 'utf8')
  } catch {
    /* 写不了顶多下次重推一遍，upsert 幂等，不会写重 */
  }
}

function readBuffer(sessionId) {
  try {
    const lines = readFileSync(bufferPath(sessionId), 'utf8').split('\n').filter(Boolean)
    return lines
      .map((line, i) => {
        try {
          return { ...JSON.parse(line), seq: i + 1 }
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function clearBuffer(sessionId) {
  for (const p of [bufferPath(sessionId), metaPath(sessionId)]) {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      /* 删不掉不影响正确性，下次会覆盖 */
    }
  }
}

/**
 * 从会话记录里取两样：这次在干什么（首条用户消息）、PM 纠正了我几次。
 * 只读用户说的话 —— 不上传对话原文，只上传这两个数字和一句目标。
 */
function readTranscript(path) {
  if (!path || !existsSync(path)) return { goal: null, corrections: 0 }

  let goal = null
  let corrections = 0

  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      const text = userText(line)
      if (!text) continue
      if (!goal) goal = oneLine(text, 300)
      if (CORRECTION_RE.test(text)) corrections += 1
    }
  } catch {
    /* 读不了就算了 */
  }

  return { goal: goal ? redact(goal) : null, corrections }
}

function userText(line) {
  try {
    const obj = JSON.parse(line)
    if (obj.type !== 'user') return null
    const content = obj.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join(' ')
    }
    return null
  } catch {
    return null
  }
}

main().catch(() => {
  /* 静默 */
})
