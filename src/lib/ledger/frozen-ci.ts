import { execSync } from 'node:child_process'
import { basename } from 'node:path'
import { checkFrozenFields } from './frozen'
import { parseLedgerFile, MAX_BODY_LINES } from './parse'

export interface FrozenCIResult {
  errors: string[]
  warnings: string[]
}

const UNQUOTED_HASH_RE = /^[^"'|>].*\s#/

function detectUnquotedHash(text: string, file: string): string[] {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fmMatch) return []
  const warnings: string[] = []
  for (const line of fmMatch[1].split(/\r?\n/)) {
    if (UNQUOTED_HASH_RE.test(line)) {
      warnings.push(
        `${file}：字段值含未加引号的「空格 #」，YAML 会把 # 后面的内容当注释丢掉——请加引号（${line.trim()}）`,
      )
    }
  }
  return warnings
}

export function runFrozenFieldCheck(
  base: string,
  head: string,
  cwd?: string,
): FrozenCIResult {
  const execOpts = { encoding: 'utf8' as const, cwd }
  const errors: string[] = []
  const warnings: string[] = []

  let diffOutput: string
  try {
    diffOutput = execSync(
      `git diff --name-status --diff-filter=MRDTA "${base}...${head}" -- 'docs/ledger/*.md'`,
      execOpts,
    ).trim()
  } catch {
    errors.push('git diff 失败——无法列出变更的台账文件')
    return { errors, warnings }
  }

  if (!diffOutput) return { errors, warnings }

  const lines = diffOutput.split('\n').filter((l) => l && !l.includes('README.md'))

  for (const line of lines) {
    const parts = line.split('\t')
    const status = parts[0]

    if (status === 'T') {
      errors.push(
        `${parts[1]}：台账卡不许改为符号链接——符号链接会绕过所有校验`,
      )
      continue
    }

    if (status.startsWith('R')) {
      errors.push(
        `${parts[1]} → ${parts[2]}：台账卡不许改名（id 冻结）；要换判据请新建一张`,
      )
      continue
    }

    if (status === 'D') {
      const file = parts[1]
      let baseText: string
      try {
        baseText = execSync(`git show "${base}:${file}"`, execOpts)
      } catch {
        errors.push(`${file}：无法读取主干版本（git show 失败），不能当作通过`)
        continue
      }
      const result = parseLedgerFile(basename(file), baseText)
      if (result.ok) {
        const st = result.entry.status
        if (st === 'decided' || st === 'done') {
          errors.push(
            `${file}：status 为 ${st} 的台账卡不许删除——结论和判据会一起消失`,
          )
        } else {
          warnings.push(
            `${file}：已验证/已失败的台账卡被删除——如果是故意归档请忽略`,
          )
        }
      } else {
        warnings.push(`${file}：主干版本解析失败（${result.error.reason}），无法确认状态`)
      }
      continue
    }

    if (status === 'A') {
      const file = parts[1]
      let headText: string
      try {
        headText = execSync(`git show "${head}:${file}"`, execOpts)
      } catch {
        errors.push(`${file}：无法读取 PR 版本（git show 失败），不能当作通过`)
        continue
      }
      const hashWarnings = detectUnquotedHash(headText, file)
      for (const w of hashWarnings) errors.push(w)

      const result = parseLedgerFile(basename(file), headText)
      if (result.ok) {
        const body = result.entry.body.trim()
        const bodyLines = body === '' ? 0 : body.split('\n').length
        if (bodyLines > MAX_BODY_LINES) {
          errors.push(
            `${file}：新卡正文 ${bodyLines} 行，超过上限 ${MAX_BODY_LINES} 行`,
          )
        }
      }
      continue
    }

    // Modified (M)
    const filePath = parts[1]

    let baseText: string
    try {
      baseText = execSync(`git show "${base}:${filePath}"`, execOpts)
    } catch {
      errors.push(`${filePath}：无法读取主干版本（git show 失败），不能当作通过`)
      continue
    }

    let headText: string
    try {
      headText = execSync(`git show "${head}:${filePath}"`, execOpts)
    } catch {
      errors.push(`${filePath}：无法读取 PR 版本（git show 失败），不能当作通过`)
      continue
    }

    const hashWarnings = detectUnquotedHash(headText, filePath)
    for (const w of hashWarnings) errors.push(w)

    const fileName = basename(filePath)
    const result = checkFrozenFields(fileName, headText, baseText)

    if (result.baseParseError) {
      warnings.push(
        `${filePath}：主干版本解析失败（${result.baseParseError.reason}），无法比对冻结字段`,
      )
    }

    if (result.parseError) {
      warnings.push(
        `${filePath}：head 版本解析失败（${result.parseError.reason}），无法比对冻结字段`,
      )
    }

    for (const v of result.violations) {
      errors.push(
        `${filePath}：冻结字段 ${v.field} 被改写（原来「${v.baseValue.slice(0, 80)}」→ 现在「${v.headValue.slice(0, 80)}」）。改了判据等于换了一张卡，请新建`,
      )
    }
  }

  return { errors, warnings }
}
