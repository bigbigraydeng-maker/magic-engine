// Local, read-only CLI for previewing a March booking import.
// Usage: npx tsx --env-file=<env> scripts/import-march-bookings.ts <clientId> <inputJsonPath> [--out <planJsonPath>]
// This version only previews: it never writes to the database. `--apply` is refused.
// The optional --out file must live outside the repository (it may contain contact ids).

import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase'
import { normaliseEmail, normalisePhone } from '@/lib/crm/identity'
import { runPreview } from '@/lib/crm/booking-import/run-preview'

const APPLY_REFUSED = '导入还没有开放：这一版只做预览，不会写入任何东西。'
const OUT_INSIDE_REPO = '输出文件不能放在仓库目录里（里面可能有联系人 id）'

interface Args {
  clientId: string
  inputPath: string
  outPath: string | null
}

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
    } else {
      positional.push(arg)
    }
  }
  if (positional.length !== 2) return null
  return { clientId: positional[0], inputPath: positional[1], outPath }
}

function isInsideRepo(target: string): boolean {
  const rel = relative(process.cwd(), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.includes('--apply')) {
    console.log(APPLY_REFUSED)
    return 2
  }

  const args = parseArgs(argv)
  if (args === null) {
    console.log('用法：import-march-bookings.ts <clientId> <inputJsonPath> [--out <planJsonPath>]')
    return 1
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
    if (isInsideRepo(args.outPath)) {
      console.log(OUT_INSIDE_REPO)
      return 3
    }
    const payload = JSON.stringify({ planSha: result.planSha, items: result.items }, null, 2)
    writeFileSync(args.outPath, payload, 'utf8')
  }

  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.log(message)
    process.exitCode = 1
  })
