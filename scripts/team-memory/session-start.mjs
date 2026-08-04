#!/usr/bin/env node
/**
 * Team Working Memory — SessionStart hook
 *
 * 这是整套系统真正解决问题的一步：新窗口开起来时，把**别的窗口踩过的坑**
 * 塞到手边。没有这一步，前面所有的录制和提炼都只是往库里堆东西
 * （前车之鉴：global_learned_lessons 建了一个月 9 条、没人读）。
 *
 * 硬性要求：3 秒拿不到就放弃。开窗口卡住比少看几条教训糟糕得多。
 */

import { writeFileSync } from 'node:fs'
import {
  readHookInput,
  ensureBufferDir,
  metaPath,
  projectKeyFromCwd,
  isManaged,
  git,
  post,
} from './config.mjs'

const CONTEXT_TIMEOUT_MS = 3000

async function main() {
  const input = await readHookInput()
  const sessionId = input.session_id
  const cwd = input.cwd || process.cwd()
  const projectKey = projectKeyFromCwd(cwd)

  if (!sessionId || !isManaged(projectKey)) return

  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const head = git(cwd, ['rev-parse', 'HEAD'])

  const ctx = await post(
    '/api/team-memory/context',
    { project_key: projectKey, goal: null },
    CONTEXT_TIMEOUT_MS,
  )

  // 服务器没有 git，「改动到底合进 main 没有」只能这台机器说了算。
  // 顺手验一下，结果攒进 meta，会话结束时一起报回去。
  const verdicts = verifyCommits(cwd, ctx?.verify_commits ?? [])

  ensureBufferDir()
  writeFileSync(
    metaPath(sessionId),
    JSON.stringify({
      session_key: sessionId,
      project_key: projectKey,
      cwd,
      git_branch: branch,
      git_head: head,
      started_at: new Date().toISOString(),
      transcript_path: input.transcript_path || null,
      commit_verdicts: verdicts,
    }),
    'utf8',
  )

  const text = render(ctx, projectKey)
  if (!text) return

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: text,
      },
    }),
  )
}

/** 用本机 git 判断这些 commit 是否已经在 main 里 */
function verifyCommits(cwd, pending) {
  const out = []
  for (const item of pending.slice(0, 20)) {
    if (!item?.sha) continue
    const containing = git(cwd, ['branch', '-r', '--contains', item.sha])
    if (containing === null) continue // 查不到（commit 不在这个仓）就不表态
    out.push({
      session_key: item.session_key,
      sha: item.sha,
      in_main: /\borigin\/main\b/.test(containing),
    })
  }
  return out
}

function render(ctx, projectKey) {
  if (!ctx) return ''
  const lessons = ctx.lessons ?? []
  const skills = ctx.skills ?? []
  const handoff = ctx.handoff ?? null
  if (lessons.length === 0 && skills.length === 0 && !handoff) return ''

  const parts = [
    `## 团队工作记忆（项目：${projectKey}）`,
    '',
    '以下内容来自**其它 Claude Code 窗口**已经踩过 / 跑通的东西，自动带过来的。',
    '把它当作已确认的事实参考，但代码和数据仍以当前仓库和数据库为准。',
  ]

  if (handoff) {
    parts.push('', '### 上一次同项目会话交接')
    parts.push(`- 分支：${handoff.git_branch ?? '(未知)'}`)
    if (handoff.goal) parts.push(`- 在干什么：${handoff.goal}`)
    if (handoff.summary) parts.push(`- 干到哪了：${handoff.summary}`)
  }

  if (lessons.length > 0) {
    parts.push('', '### 别的窗口踩过的坑')
    for (const l of lessons) {
      const tag = l.scope === 'global' ? '通用' : projectKey
      const when = (l.last_confirmed_at ?? '').slice(0, 10)
      parts.push(`- [${tag}] **${l.title}** —— ${l.lesson}（${when}，依据：${sourceLabel(l)}）`)
    }
  }

  if (skills.length > 0) {
    parts.push('', '### 已跑通的套路（要用就说名字，我会调出完整步骤）')
    for (const s of skills) {
      const gate = s.requires_approval ? '⚠️ 含需 PM 放行的步骤' : ''
      parts.push(`- \`${s.skill_key}\` ${s.name} —— ${s.description} ${gate}`.trim())
    }
  }

  return parts.join('\n')
}

/**
 * 依据标签必须诚实。
 * 从旧本地记忆搬过来的那批是「祖传条目」—— 它们没走过新系统的硬证据闸门，
 * 标成「PM 当场纠正过」是误导，读的人会高估它的可靠度。
 */
function sourceLabel(lesson) {
  if (lesson.source === 'imported_memory') return '早期本地记忆导入，未经新闸门验证'
  if (lesson.source === 'manual') return '人工录入'
  return (
    {
      user_correction: 'PM 当场纠正过',
      merged: '改动已合入 main',
      tests_passed: '测试跑通',
      multi_session: '多个会话重现',
    }[lesson.evidence_kind] ?? lesson.evidence_kind
  )
}

main().catch(() => {
  /* 静默 —— 拿不到记忆也要让 PM 正常开工 */
})
