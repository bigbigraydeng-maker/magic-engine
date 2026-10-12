// Local, read-only CLI for previewing a March booking import.
// Usage: npx tsx --env-file=<env> scripts/import-march-bookings.ts <clientId> <inputJsonPath> [--out <planJsonPath>]
// This version only previews: it never writes to the database, and `--apply` (in any spelling) is refused.
// Every path check happens BEFORE the database is touched. The input file holds guest contact details and must stay
// outside the repository; the optional --out file holds contact ids and must too (and is never overwritten).
// Errors are printed as a fixed sentence only: a database error text can echo the values that were looked up.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase'
import { normaliseEmail, normalisePhone } from '@/lib/crm/identity'
import { runPreview } from '@/lib/crm/booking-import/run-preview'

const APPLY_REFUSED = '导入还没有开放：这一版只做预览，不会写入任何东西。'
const USAGE = '用法：import-march-bookings.ts <clientId> <inputJsonPath> [--out <planJsonPath>]'
const PATH_REFUSED = '输入文件和输出文件都不能放在仓库目录里（里面有客人联系方式或联系人 id），输出文件还必须是新的 .json 文件、不能覆盖已有文件、不能和输入文件同一个'
const GENERIC_ERROR = '出错了（为避免泄露客人信息，这里不显示详情）：'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Args {
  clientId: string
  inputPath: string
  outPath: string | null
}

/** Strict parsing: anything starting with --apply is refused by the caller; any other unknown flag is an error. */
function parseArgs(argv: string[]): Args | null {
  const positional: string[] = []
  let outPath: string | null = null
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') {
      const next = argv[i + 1]
      if (next === undefined) return null
      outPath = next
      i += 1
    } else if (arg.startsWith('--')) {
      return null
    } else {
      positional.push(arg)
    }
  }
  if (positional.length !== 2 || !UUID_RE.test(positional[0])) return null
  return { clientId: positional[0], inputPath: positional[1], outPath }
}

/** The repository root, found from where this script lives (not from the current directory). */
function repoRoot(): string {
  const here = dirname(new URL(import.meta.url).pathname)
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim()
  return realpathSync(top)
}

/** Real path of a file that may not exist yet: the real path of its directory plus its name. Compared lower-case. */
function realKey(target: string): string {
  const abs = resolve(target)
  const dir = realpathSync(dirname(abs))
  return resolve(dir, abs.slice(dirname(abs).length + 1)).toLowerCase()
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root.toLowerCase(), target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** True when the paths are acceptable. Called before any database access. */
function pathsAreSafe(args: Args): boolean {
  const root = repoRoot()
  if (!existsSync(args.inputPath)) return false
  if (isInside(root, realpathSync(resolve(args.inputPath)).toLowerCase())) return false
  if (args.outPath === null) return true
  if (extname(args.outPath).toLowerCase() !== '.json') return false
  if (existsSync(args.outPath)) return false
  const outKey = realKey(args.outPath)
  if (isInside(root, outKey)) return false
  return outKey !== realpathSync(resolve(args.inputPath)).toLowerCase()
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.some((a) => a.startsWith('--apply'))) {
    console.log(APPLY_REFUSED)
    return 2
  }

  const args = parseArgs(argv)
  if (args === null) {
    console.log(USAGE)
    return 1
  }
  if (!pathsAreSafe(args)) {
    console.log(PATH_REFUSED)
    return 3
  }

  const rawJson = readFileSync(args.inputPath, 'utf8')
  const result = await runPreview({
    clientId: args.clientId,
    rawJson,
    db: supabaseAdmin,
    norm: { normalisePhone, normaliseEmail },
  })

  for (const line of result.lines) console.log(line)

  if (args.outPath !== null) {
    const payload = JSON.stringify(
      {
        clientId: args.clientId,
        inputSha256: createHash('sha256').update(rawJson).digest('hex'),
        generatedAt: new Date().toISOString(),
        planSha: result.planSha,
        items: result.items,
      },
      null,
      2,
    )
    writeFileSync(args.outPath, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  }

  // Rows that could not be read mean the plan does not cover the whole input: do not report plain success.
  return result.invalidCount > 0 ? 4 : 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    const name = error instanceof Error ? error.name : 'Error'
    console.error(`${GENERIC_ERROR}${name}`)
    process.exitCode = 1
  })
