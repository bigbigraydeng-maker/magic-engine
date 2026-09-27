import { execSync } from 'node:child_process'
import { basename } from 'node:path'
import { checkFrozenFields } from '../src/lib/ledger/frozen'

const base = process.env.BASE_SHA
const head = process.env.HEAD_SHA
if (!base || !head) {
  console.error('BASE_SHA and HEAD_SHA environment variables are required')
  process.exit(1)
}

const diffOutput = execSync(
  `git diff --name-status --diff-filter=MRD "${base}...${head}" -- 'docs/ledger/*.md'`,
  { encoding: 'utf8' },
).trim()

if (!diffOutput) {
  console.log('没有修改过的台账文件，跳过冻结字段检查')
  process.exit(0)
}

let hasViolations = false
const lines = diffOutput.split('\n').filter((l) => !l.includes('README.md'))

for (const line of lines) {
  if (!line) continue
  const parts = line.split('\t')
  const status = parts[0]

  if (status === 'D') {
    console.log(`::warning file=${parts[1]}::已在主干上的台账卡被删除——如果是故意归档请忽略`)
    continue
  }

  let basePath: string
  let headPath: string

  if (status.startsWith('R')) {
    basePath = parts[1]
    headPath = parts[2]
  } else {
    basePath = parts[1]
    headPath = parts[1]
  }

  let baseText: string | null = null
  try {
    baseText = execSync(`git show "${base}:${basePath}"`, { encoding: 'utf8' })
  } catch {
    continue
  }

  let headText: string
  try {
    headText = execSync(`git show "${head}:${headPath}"`, { encoding: 'utf8' })
  } catch {
    continue
  }

  const fileName = basename(headPath)
  const result = checkFrozenFields(fileName, headText, baseText)

  if (result.baseParseError) {
    console.log(
      `::warning file=${headPath}::主干版本解析失败（${result.baseParseError.reason}），无法比对冻结字段`,
    )
  }

  if (result.parseError) {
    console.log(
      `::warning file=${headPath}::head 版本解析失败（${result.parseError.reason}），无法比对冻结字段`,
    )
  }

  for (const v of result.violations) {
    console.log(
      `::error file=${headPath}::冻结字段 ${v.field} 被改写（原来「${v.baseValue.slice(0, 80)}」→ 现在「${v.headValue.slice(0, 80)}」）。改了判据等于换了一张卡，请新建`,
    )
    hasViolations = true
  }
}

if (hasViolations) {
  process.exit(1)
}

console.log('冻结字段检查通过')
