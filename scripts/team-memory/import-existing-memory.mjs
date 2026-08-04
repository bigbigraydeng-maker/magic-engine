#!/usr/bin/env node
/**
 * Team Working Memory — 把现有的本地记忆一次性搬进后台
 *
 *   node scripts/team-memory/import-existing-memory.mjs --dry-run   先看会搬什么
 *   node scripts/team-memory/import-existing-memory.mjs             真搬
 *
 * 背景：2026-08-02 实测，130 条记忆分散在 4 个互不相通的本地目录里，
 * 另外 37 个 worktree 窗口各 0 条。搬进后台后，那 37 个窗口第一次能看到它们。
 *
 * 说明一句：这批老记忆是「祖传条目」—— 它们没有经过新系统的硬证据闸门，
 * 但它们全都是 PM 在真实对话里给出的判断，所以按 user_correction 记，
 * 并统一标 source=imported_memory，将来出问题能一眼分辨来源。
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { post } from './config.mjs'

/**
 * 记忆目录名是把绝对路径的 `/` 全换成 `-` 得来的，
 * 而项目名本身就带 `-`（magic-engine），所以换不回去 —— 只能正着认。
 * 长的排前面，避免将来出现互为前缀的项目名时认错。
 */
const KNOWN_PROJECTS = ['magic-lab-academy', 'magic-engine', 'chinatravel', 'midashand']

function projectFromDirName(dir) {
  return (
    KNOWN_PROJECTS.filter((k) => dir.includes(`-Projects-${k}`)).sort(
      (a, b) => b.length - a.length,
    )[0] ?? 'unknown'
  )
}

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const DRY_RUN = process.argv.includes('--dry-run')

/**
 * 判断一条记忆属于哪一格。
 * PM 拍板的两格：project = 只在这个项目提醒，global = 哪儿都提醒。
 *
 * 规则：讲「怎么干活 / 怎么沟通」的归 global；
 *       但只要提到具体客户，就算它写成 feedback 也归 project —— 客户的规矩
 *       跑到别的项目窗口里瞎提醒，比不提醒更烦人。
 */
const CLIENT_NAMES = [
  'cts', 'oztop', 'roman', 'parkhome', 'kiteroa', 'carrington', 'tradeplus',
  'chanceedu', 'jayden', 'midashand', 'darui', '大瑞', 'magic-lab-class',
]

function decideScope(name, description, type) {
  const haystack = `${name} ${description}`.toLowerCase()
  const mentionsClient = CLIENT_NAMES.some((c) => haystack.includes(c))
  if (mentionsClient) return 'project'
  return type === 'feedback' || type === 'user' ? 'global' : 'project'
}

function parseMemoryFile(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const [, front, body] = m

  const name = (front.match(/^name:\s*(.+)$/m) || [])[1]?.trim()
  const description = (front.match(/^description:\s*(.+)$/m) || [])[1]?.trim() ?? ''
  const type = (front.match(/^\s*type:\s*(.+)$/m) || [])[1]?.trim() ?? 'project'

  if (!name) return null
  return { name, description, type, body: body.trim() }
}

function collect() {
  if (!existsSync(PROJECTS_DIR)) return []
  const out = []

  for (const dir of readdirSync(PROJECTS_DIR)) {
    const memDir = join(PROJECTS_DIR, dir, 'memory')
    if (!existsSync(memDir)) continue

    const projectKey = projectFromDirName(dir)

    for (const file of readdirSync(memDir)) {
      if (!file.endsWith('.md') || file === 'MEMORY.md') continue
      const parsed = parseMemoryFile(readFileSync(join(memDir, file), 'utf8'))
      if (!parsed) continue

      const scope = decideScope(parsed.name, parsed.description, parsed.type)
      out.push({
        lesson_key: `mem:${projectKey}:${parsed.name}`,
        scope,
        project_key: scope === 'project' ? projectKey : null,
        title: parsed.description || parsed.name,
        lesson: parsed.body.slice(0, 4000),
        rationale: `从本机记忆导入（${dir}/memory/${file}）`,
        evidence_kind: 'user_correction',
        evidence: { imported_from: `${dir}/memory/${file}`, original_type: parsed.type },
        confidence: 0.9,
        source: 'imported_memory',
      })
    }
  }
  return out
}

async function main() {
  const lessons = collect()
  if (lessons.length === 0) {
    console.log('没找到可导入的记忆文件。')
    return
  }

  const byScope = lessons.reduce((acc, l) => {
    const k = l.scope === 'global' ? '哪儿都提醒' : `只在 ${l.project_key}`
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})

  console.log(`共找到 ${lessons.length} 条：`)
  Object.entries(byScope).forEach(([k, v]) => console.log(`  ${k}: ${v} 条`))

  const unknown = lessons.filter((l) => l.project_key === 'unknown')
  if (unknown.length > 0) {
    console.log(`\n⚠️ 有 ${unknown.length} 条认不出项目，会被跳过：`)
    unknown.slice(0, 10).forEach((l) => console.log(`  - ${l.lesson_key}`))
  }

  const importable = lessons.filter((l) => l.project_key !== 'unknown')

  if (DRY_RUN) {
    console.log('\n--dry-run：没有写入任何东西')
    console.log('\n样例：')
    console.log(JSON.stringify(importable.slice(0, 2), null, 2))
    return
  }

  // 分批推，避免单个请求过大
  let written = 0
  for (let i = 0; i < importable.length; i += 100) {
    const batch = importable.slice(i, i + 100)
    const res = await post('/api/team-memory/lessons', { lessons: batch }, 30000)
    if (!res) {
      console.error(`第 ${i / 100 + 1} 批推送失败（网络或鉴权问题），已中止`)
      process.exit(1)
    }
    written += res.written ?? 0
    console.log(`  已写入 ${written}/${importable.length}`)
  }

  console.log(`\n完成：${written} 条已进后台。`)
}

main().catch((err) => {
  console.error('导入失败:', err.message)
  process.exit(1)
})
