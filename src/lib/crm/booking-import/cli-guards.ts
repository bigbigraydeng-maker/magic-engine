// Pure-ish argument and path guards for the local import preview script (kept out of the script so they can be tested).
// The input file holds guest contact details and the --out file holds contact ids: neither may sit inside any
// checkout of the repository (this worktree OR the main checkout) and --out must be a new .json file.

import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CliArgs {
  clientId: string
  inputPath: string
  outPath: string | null
}

/** Strict parsing: any `--` flag other than a separate `--out <path>` is rejected (the caller refuses --apply first). */
export function parseArgs(argv: string[]): CliArgs | null {
  const positional: string[] = []
  let outPath: string | null = null
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) return null
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

/** Real path of a file that may not exist yet: the real path of its directory plus its name. Lower-case. */
function realKey(target: string): string {
  const abs = resolve(target)
  return resolve(realpathSync(dirname(abs)), basename(abs)).toLowerCase()
}

/** True when target is root itself or below it. Only a real ".." segment means "outside". */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root.toLowerCase(), target)
  if (rel === '') return true
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false
  return !isAbsolute(rel)
}

/** True when the paths are acceptable. `roots` = every repository checkout directory. Called before any DB access. */
export function pathsAreSafe(args: CliArgs, roots: string[]): boolean {
  if (!existsSync(args.inputPath)) return false
  const inputKey = realpathSync(resolve(args.inputPath)).toLowerCase()
  if (roots.some((root) => isInside(root, inputKey))) return false
  if (args.outPath === null) return true
  if (extname(args.outPath).toLowerCase() !== '.json') return false
  if (existsSync(args.outPath)) return false
  const outKey = realKey(args.outPath)
  if (roots.some((root) => isInside(root, outKey))) return false
  return outKey !== inputKey
}
