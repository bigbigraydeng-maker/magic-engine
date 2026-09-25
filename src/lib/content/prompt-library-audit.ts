/**
 * 李白 · 提示词库月检（只报告不改）。
 *
 * `docs/agents/prompt-library/` 是李白管的提示词库（docs/agents/70-libai.md §五），
 * 每月第一个周二读一遍：
 *   - 文件里点名的代码路径还在不在
 *   - 变更日志有没有记录这个文件
 *   - 变更日志里「待建」的文件建没建
 *
 * 结果只进回执和今日待办，本模块不改任何文件。
 * 读不到目录 = 报错字段，不给空结果冒充「全好」。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const PROMPT_LIBRARY_DIR = 'docs/agents/prompt-library'
export const PROMPT_LIBRARY_CHANGELOG = 'CHANGELOG.md'

export interface PromptLibraryFinding {
  file: string
  line: number
  reference: string
  reason: string
}

export interface PromptLibraryAudit {
  checked_at: string
  files_checked: number
  findings: PromptLibraryFinding[]
  error: string | null
}

const CODE_REF_RE = /src\/[A-Za-z0-9_./[\]-]+/g

/**
 * 从 markdown 里抽出所有 `src/...` 代码路径引用。
 * 每行 1-based 行号；同一行内去重。
 */
export function extractCodeRefs(markdown: string): Array<{ line: number; ref: string }> {
  const out: Array<{ line: number; ref: string }> = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const seen = new Set<string>()
    const matches = lines[i].match(CODE_REF_RE)
    if (!matches) continue
    for (const raw of matches) {
      const ref = cleanRef(raw)
      if (!ref || seen.has(ref)) continue
      seen.add(ref)
      out.push({ line: lineNo, ref })
    }
  }
  return out
}

/** 去掉 `::…`、反引号、`)`、`,`、`.` 等尾随字符。 */
function cleanRef(raw: string): string {
  let ref = raw
  const dblColon = ref.indexOf('::')
  if (dblColon !== -1) ref = ref.slice(0, dblColon)
  ref = ref.replace(/[`),.]+$/g, '')
  return ref
}

/**
 * 判断仓库里是否存在该引用。
 * 无扩展名时，额外接受 `<ref>.ts`、`<ref>/route.ts`、`<ref>/index.ts`。
 */
export function refExists(repoRoot: string, ref: string): boolean {
  if (existsSync(join(repoRoot, ref))) return true
  const hasExt = /\.[A-Za-z0-9]+$/.test(ref)
  if (hasExt) return false
  return (
    existsSync(join(repoRoot, `${ref}.ts`)) ||
    existsSync(join(repoRoot, ref, 'route.ts')) ||
    existsSync(join(repoRoot, ref, 'index.ts'))
  )
}

/**
 * 从变更日志里抽出「待建」标题下 `- \`name.md\`` 列出的文件名。
 */
export function extractPendingFiles(changelog: string): string[] {
  const out: string[] = []
  const lines = changelog.split('\n')
  let inPending = false
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      inPending = heading[1].includes('待建')
      continue
    }
    if (!inPending) continue
    const item = line.match(/^-\s+`([^`]+\.md)`/)
    if (item) out.push(item[1])
  }
  return out
}

/**
 * 审计单个提示词文件：
 *   (a) 点名的代码路径找不到
 *   (b) 变更日志从没记录过这个文件
 */
export function auditPromptFile(
  repoRoot: string,
  file: string,
  markdown: string,
  changelog: string
): PromptLibraryFinding[] {
  const findings: PromptLibraryFinding[] = []
  for (const { line, ref } of extractCodeRefs(markdown)) {
    if (!refExists(repoRoot, ref)) {
      findings.push({
        file,
        line,
        reference: ref,
        reason: '文件里点名的代码路径在仓库里找不到',
      })
    }
  }
  if (!changelog.includes(file)) {
    findings.push({
      file,
      line: 0,
      reference: file,
      reason: '变更日志（CHANGELOG.md）从没记录过这个文件',
    })
  }
  return findings
}

/**
 * 月检入口。读不到目录 = 报错字段，不给空结果冒充「全好」。
 */
export function auditPromptLibrary(
  repoRoot: string = process.cwd(),
  now: Date = new Date()
): PromptLibraryAudit {
  const checked_at = now.toISOString()
  const dir = join(repoRoot, PROMPT_LIBRARY_DIR)

  let files: string[]
  try {
    files = readdirSync(dir)
  } catch (err) {
    return {
      checked_at,
      files_checked: 0,
      findings: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const changelogPath = join(dir, PROMPT_LIBRARY_CHANGELOG)
  if (!existsSync(changelogPath)) {
    return { checked_at, files_checked: 0, findings: [], error: '变更日志不存在' }
  }
  const changelog = readFileSync(changelogPath, 'utf8')

  const mdFiles = files
    .filter((f) => f.endsWith('.md') && f !== PROMPT_LIBRARY_CHANGELOG)
    .sort()

  const findings: PromptLibraryFinding[] = []
  for (const file of mdFiles) {
    const markdown = readFileSync(join(dir, file), 'utf8')
    findings.push(...auditPromptFile(repoRoot, file, markdown, changelog))
  }

  for (const name of extractPendingFiles(changelog)) {
    if (!existsSync(join(dir, name))) {
      findings.push({
        file: PROMPT_LIBRARY_CHANGELOG,
        line: 0,
        reference: name,
        reason: '变更日志说待建，文件还没建',
      })
    }
  }

  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))

  return { checked_at, files_checked: mdFiles.length, findings, error: null }
}
