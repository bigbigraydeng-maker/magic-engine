/**
 * Put local files into a client's document library (资料库), the same way the page's upload does.
 *
 *   Dry run (default; reads local files only, no network, no keys):
 *     npx tsx scripts/client-documents/import-files.ts --client <client uuid> --manifest <manifest.json>
 *
 *   Write for real (needs the service key in an env file, and the project ref as a safety check):
 *     npx tsx --env-file=<env file> scripts/client-documents/import-files.ts \
 *       --client <client uuid> --manifest <manifest.json> --apply --project-ref <ref>
 *
 * It calls the library's own `saveUploadedDocument`, so the file checks, the duplicate refusal and
 * the clean-up when a row cannot be written are exactly the page's. A file that is already a current
 * file for that client is reported as "already there" and is not an error, so the script can be re-run.
 * Writing to the real library is a production change: run it only after the owner has approved.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { checkUploadedFile } from '../../src/lib/client-documents/files'
import { isUuid } from '../../src/lib/client-documents/input'
import { parseManifest, type ManifestEntry } from './manifest'

const IMPORT_ACTOR = 'script:import-files'

interface Args {
  client: string
  manifest: string
  apply: boolean
  projectRef: string | null
}

function parseArgs(argv: string[]): Args | string {
  const args = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) return `unexpected argument: ${arg}`
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      args.set(arg.slice(2), next)
      i += 1
    } else {
      args.set(arg.slice(2), true)
    }
  }
  const client = args.get('client')
  const manifest = args.get('manifest')
  const projectRef = args.get('project-ref')
  if (typeof client !== 'string' || !isUuid(client)) return '--client <client uuid> is required'
  if (typeof manifest !== 'string') return '--manifest <manifest.json> is required'
  return {
    client,
    manifest: path.resolve(manifest),
    apply: args.get('apply') === true,
    projectRef: typeof projectRef === 'string' ? projectRef : null,
  }
}

function describe(entry: ManifestEntry, bytes: Buffer): string {
  const checked = checkUploadedFile(path.basename(entry.path), bytes)
  if (!checked.ok) return `REFUSED  ${path.basename(entry.path)}  ${checked.error}`
  const { file } = checked
  return [
    'OK      ',
    path.basename(entry.path),
    `${(file.sizeBytes / 1024).toFixed(0)} KB`,
    file.mimeType,
    `sha256 ${file.sha256.slice(0, 12)}`,
    `${entry.category}/${entry.visibility}`,
    entry.versionLabel ?? '-',
  ].join('  ')
}

function loadEntries(args: Args): { entry: ManifestEntry; bytes: Buffer }[] | string {
  const parsed = parseManifest(JSON.parse(readFileSync(args.manifest, 'utf8')), path.dirname(args.manifest))
  if (!parsed.ok) return parsed.errors.join('\n')
  return parsed.entries.map(entry => ({ entry, bytes: readFileSync(entry.path) }))
}

function buildForm(entry: ManifestEntry, bytes: Buffer): FormData {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], path.basename(entry.path)))
  if (entry.title) form.set('title', entry.title)
  form.set('category', entry.category)
  form.set('visibility', entry.visibility)
  if (entry.versionLabel) form.set('versionLabel', entry.versionLabel)
  if (entry.description) form.set('description', entry.description)
  return form
}

async function applyAll(args: Args, items: { entry: ManifestEntry; bytes: Buffer }[]): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const host = url ? new URL(url).hostname : ''
  if (!args.projectRef || host !== `${args.projectRef}.supabase.co`) {
    console.error(`Refusing to write: --project-ref must match the project in the env file (env host: ${host || 'none'}).`)
    return 2
  }
  console.log(`Writing to project ${args.projectRef}, client ${args.client}`)

  const { saveUploadedDocument } = await import('../../src/lib/client-documents/upload')
  let failed = 0
  for (const { entry, bytes } of items) {
    const outcome = await saveUploadedDocument({ clientId: args.client, form: buildForm(entry, bytes), actor: IMPORT_ACTOR })
    const duplicate = outcome.status === 409 && outcome.body.code === 'duplicate_content'
    if (outcome.status !== 201 && !duplicate) failed += 1
    const label = outcome.status === 201 ? 'ADDED   ' : duplicate ? 'ALREADY ' : 'FAILED  '
    console.log(`${label} ${path.basename(entry.path)}  ${JSON.stringify(outcome.body.error ?? { id: (outcome.body.document as { id?: string } | undefined)?.id })}`)
  }
  return failed > 0 ? 1 : 0
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args === 'string') {
    console.error(args)
    return 2
  }
  const items = loadEntries(args)
  if (typeof items === 'string') {
    console.error(items)
    return 2
  }

  for (const { entry, bytes } of items) console.log(describe(entry, bytes))
  const refused = items.filter(({ entry, bytes }) => !checkUploadedFile(path.basename(entry.path), bytes).ok).length
  if (refused > 0) {
    console.error(`${refused} file(s) refused; nothing was written.`)
    return 1
  }
  if (!args.apply) {
    console.log(`Dry run: ${items.length} file(s) look fine. Add --apply --project-ref <ref> to write.`)
    return 0
  }
  return applyAll(args, items)
}

main().then(code => process.exit(code), error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
