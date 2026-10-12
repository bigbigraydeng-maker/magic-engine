// Local, read-only CLI for previewing a March booking import.
// Usage: npx tsx --env-file=<env> scripts/import-march-bookings.ts <clientId> <inputJsonPath> [--out <planJsonPath>]
// This version only previews: it never writes to the database, and `--apply` (in any spelling) is refused.
// Every path check happens BEFORE the database is touched. The input file holds guest contact details and must stay
// outside the repository; the optional --out file holds contact ids and must too (and is never overwritten).
// Errors are printed as a fixed sentence only: a database error text can echo the values that were looked up.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase'
import { normaliseEmail, normalisePhone } from '@/lib/crm/identity'
import { parseArgs, pathsAreSafe } from '@/lib/crm/booking-import/cli-guards'
import { runPreview } from '@/lib/crm/booking-import/run-preview'

const APPLY_REFUSED = '导入还没有开放：这一版只做预览，不会写入任何东西。'
const USAGE = '用法：import-march-bookings.ts <clientId> <inputJsonPath> [--out <planJsonPath>]'
const PATH_REFUSED = '输入文件和输出文件都不能放在仓库目录里（里面有客人联系方式或联系人 id），输出文件还必须是新的 .json 文件、不能覆盖已有文件、不能和输入文件同一个'
const GENERIC_ERROR = '出错了（为避免泄露客人信息，这里不显示详情）：'

/** Every checkout of the repository: this worktree's top level AND the main checkout (via the common git dir). */
function repoRoots(): string[] {
  const here = dirname(new URL(import.meta.url).pathname)
  const git = (arg: string) => execFileSync('git', ['rev-parse', arg], { cwd: here, encoding: 'utf8' }).trim()
  const top = realpathSync(git('--show-toplevel'))
  const common = realpathSync(resolve(here, git('--git-common-dir')))
  return Array.from(new Set([top, dirname(common)]))
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
  if (!pathsAreSafe(args, repoRoots())) {
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
