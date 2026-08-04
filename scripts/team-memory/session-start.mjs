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

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
const STATE_DOC_MAX_BYTES = 64 * 1024

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

  // 现状在前、别人的教训在后：先知道系统是什么样，才判断得了那些教训还成不成立。
  const sections = [readStateDoc(cwd), render(ctx, projectKey)].filter(Boolean)
  if (sections.length === 0) return

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: sections.join('\n\n---\n\n'),
      },
    }),
  )
}

/**
 * 开窗口时自动带上 docs/STATE.md（系统现状）。
 *
 * 为什么非得自动：CLAUDE.md 里只有一句「每次开新会话先读 STATE.md」+ 一个链接，
 * 那是一张纸条，不是一道闸门。2026-08-04 有一场会话照着 CLAUDE.md 干了一整场、
 * 一次都没打开 STATE.md，于是拿着一份十天前的旧文档体系下判断，还提议去做一件
 * 早就做完的事。纸条治不了这个，塞进上下文才治得了。
 *
 * 没有这个文件的项目（大多数）静默跳过 —— 读不到永远不能拦住开窗口。
 */
function readStateDoc(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!root) return ''
  try {
    const path = join(root, 'docs', 'STATE.md')
    if (statSync(path).size > STATE_DOC_MAX_BYTES) return ''
    const body = readFileSync(path, 'utf8').trim()
    if (!body) return ''
    return [
      '## 系统现状（docs/STATE.md · 开窗口自动带上）',
      '',
      '**唯一真相源**：现在什么在跑 / 部署在哪 / 哪个模块对应哪段代码。',
      '跟印象里的情况冲突时以这份为准；发现它自己过时了就去改它，不要绕过它。',
      '',
      body,
    ].join('\n')
  } catch {
    return ''
  }
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
