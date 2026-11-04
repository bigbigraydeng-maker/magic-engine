// Studio mirror sync tool: copies new/updated files from the Dropbox source
// (where top-level names may be symlinks) into the local mirror the factory
// worker reads from. Never deletes anything in the mirror.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, copyFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { sha256File } from '../music-vocal-gate.mjs'

export const SHARED_SCOPES = ['Music', '_shared/music']
export const CLIENT_SUBDIRS = ['remotion-assets', 'brandkit']
export const ADD_ONLY_SCOPES = ['Music', '_shared/music']
export const MANIFEST_NAME = 'MIRROR-MANIFEST.json'
// A client folder is one path segment; '..' or '/' would let a scope escape the mirror.
const SAFE_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Build the ordered list of scopes to sync for the given client folders.
export function scopesFor(clientFolders) {
  const scopes = []
  for (const f of clientFolders ?? []) {
    for (const sub of CLIENT_SUBDIRS) scopes.push(`${f}/${sub}`)
  }
  for (const s of SHARED_SCOPES) scopes.push(s)
  return scopes
}

// Recursively list regular files under root, keyed by POSIX relative path.
export function listFiles(root, errors) {
  const out = new Map()
  if (!existsSync(root)) return out
  walk(root, root, out, errors)
  return out
}

function walk(root, dir, out, errors) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (e) {
    if (errors) errors.push({ path: dir, error: e.message })
    return
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    if (name.includes('.sync-tmp-')) continue
    const p = join(dir, name)
    let st
    try {
      st = lstatSync(p)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) {
      walk(root, p, out, errors)
      continue
    }
    if (!st.isFile()) continue
    const rel = relative(root, p).split(sep).join('/')
    out.set(rel, { size: st.size, mtimeMs: st.mtimeMs })
  }
}

// Compare one scope between source and mirror; produce a copy plan.
export async function planScope({ sourceRoot, mirrorRoot, scope, manifestByPath = new Map() }) {
  const srcPath = join(sourceRoot, scope)
  const dstDir = join(mirrorRoot, scope)
  if (!existsSync(srcPath)) {
    const mirrorHasFiles = listFiles(dstDir).size > 0
    return { scope, missingSource: true, mirrorHasFiles, srcDir: null, dstDir, copy: [], touch: [], conflicts: [], onlyInMirror: [], sourceErrors: [] }
  }
  const srcDir = realpathSync(srcPath)
  const sourceErrors = []
  const src = listFiles(srcDir, sourceErrors)
  const dst = listFiles(dstDir)
  const copy = []
  const touch = []
  const conflicts = []
  const onlyInMirror = []
  const addOnly = ADD_ONLY_SCOPES.includes(scope)
  const srcKeys = [...src.keys()].sort()
  for (const rel of srcKeys) {
    const s = src.get(rel)
    if (!dst.has(rel)) {
      copy.push({ rel, reason: 'missing', size: s.size })
      continue
    }
    const d = dst.get(rel)
    // Round, not trunc: Dropbox mtimes carry sub-millisecond digits that a
    // filesystem may round when we copy them onto the mirror file.
    const sM = Math.round(s.mtimeMs)
    const dM = Math.round(d.mtimeMs)
    if (s.size === d.size && sM === dM) continue
    const srcFile = join(srcDir, rel)
    const dstFile = join(dstDir, rel)
    const srcHash = await sha256File(srcFile)
    const dstHash = await sha256File(dstFile)
    if (srcHash === dstHash) {
      if (sM !== dM) touch.push({ rel })
      continue
    }
    if (addOnly) {
      conflicts.push({ rel, reason: 'add_only_scope' })
      continue
    }
    if (sM > dM) {
      copy.push({ rel, reason: 'changed', size: s.size })
      continue
    }
    const m = manifestByPath.get(scope + '/' + rel)
    if (m && m.sha256 === dstHash) {
      copy.push({ rel, reason: 'changed', size: s.size })
    } else {
      conflicts.push({ rel, reason: 'mirror_newer' })
    }
  }
  const dstKeys = [...dst.keys()].sort()
  for (const rel of dstKeys) {
    if (!src.has(rel)) onlyInMirror.push(rel)
  }
  return { scope, missingSource: false, mirrorHasFiles: dst.size > 0, srcDir, dstDir, copy, touch, conflicts, onlyInMirror, sourceErrors }
}

// True when dir resolves inside mirrorRoot (or is mirrorRoot itself). Checks the
// nearest existing ancestor, so a symlinked folder is caught before mkdir creates
// anything through it.
function insideMirror(dir, mirrorRoot) {
  let probe = dir
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
  const realDir = realpathSync(probe)
  const realRoot = realpathSync(mirrorRoot)
  return realDir === realRoot || realDir.startsWith(realRoot + sep)
}

// Copy planned files into the mirror via temp file + rename. Never deletes.
export function applyScope(plan, mirrorRoot) {
  const copied = []
  const touched = []
  const failed = []
  for (const item of plan.copy ?? []) {
    const from = join(plan.srcDir, item.rel)
    const to = join(plan.dstDir, item.rel)
    const tmp = to + '.sync-tmp-' + process.pid
    try {
      if (!insideMirror(dirname(to), mirrorRoot)) {
        failed.push({ rel: plan.scope + '/' + item.rel, error: '目标目录指向镜像外面，拒绝写入' })
        continue
      }
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, tmp)
      const st = statSync(from)
      utimesSync(tmp, st.atimeMs / 1000, st.mtimeMs / 1000)
      renameSync(tmp, to)
      copied.push(plan.scope + '/' + item.rel)
    } catch (e) {
      if (existsSync(tmp)) {
        try { unlinkSync(tmp) } catch { /* ignore */ }
      }
      failed.push({ rel: plan.scope + '/' + item.rel, error: e.message })
    }
  }
  for (const item of plan.touch ?? []) {
    try {
      if (!insideMirror(dirname(join(plan.dstDir, item.rel)), mirrorRoot)) {
        failed.push({ rel: plan.scope + '/' + item.rel, error: '目标目录指向镜像外面，拒绝写入' })
        continue
      }
      const st = statSync(join(plan.srcDir, item.rel))
      utimesSync(join(plan.dstDir, item.rel), st.atimeMs / 1000, st.mtimeMs / 1000)
      touched.push(plan.scope + '/' + item.rel)
    } catch (e) {
      failed.push({ rel: plan.scope + '/' + item.rel, error: e.message })
    }
  }
  return { copied, touched, failed }
}

// Rebuild the mirror manifest, reusing hashes for unchanged files.
export async function rebuildManifest({ mirrorRoot, scopes, copiedPaths, now = new Date() }) {
  const manifestPath = join(mirrorRoot, MANIFEST_NAME)
  const previous = readPreviousManifest(manifestPath)
  const prevByPath = new Map()
  for (const f of Array.isArray(previous.files) ? previous.files : []) {
    if (f && typeof f.path === 'string') prevByPath.set(f.path, f)
  }
  const copiedSet = new Set(copiedPaths ?? [])
  const files = []
  for (const scope of scopes ?? []) {
    const listed = listFiles(join(mirrorRoot, scope))
    for (const [rel, info] of listed) {
      const path = scope + '/' + rel
      const prev = prevByPath.get(path)
      const mtimeMs = Math.trunc(info.mtimeMs)
      let sha256
      if (prev && prev.bytes === info.size && prev.mtime_ms === mtimeMs && !copiedSet.has(path)) {
        sha256 = prev.sha256
      } else {
        sha256 = await sha256File(join(mirrorRoot, scope, rel))
      }
      files.push({ path, bytes: info.size, sha256, mtime_ms: mtimeMs })
    }
  }
  const prefixes = (scopes ?? []).map((s) => s + '/')
  for (const [path, prev] of prevByPath) {
    if (prefixes.some((p) => path.startsWith(p))) continue
    files.push({ path, bytes: prev.bytes, sha256: prev.sha256, mtime_ms: prev.mtime_ms })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const obj = {
    ...previous,
    refreshed_at: now.toISOString(),
    refreshed_by: 'scripts/factory-worker/tools/sync-studio-mirror.mjs',
    files,
  }
  const tmp = manifestPath + '.tmp'
  writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n')
  renameSync(tmp, manifestPath)
  return files
}

function readPreviousManifest(manifestPath) {
  if (!existsSync(manifestPath)) return {}
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) ?? {}
  } catch {
    return {}
  }
}

// Map of manifest path → entry from the previous manifest.
export function readManifestByPath(mirrorRoot) {
  const previous = readPreviousManifest(join(mirrorRoot, MANIFEST_NAME))
  const out = new Map()
  for (const f of Array.isArray(previous.files) ? previous.files : []) {
    if (f && typeof f.path === 'string') out.set(f.path, f)
  }
  return out
}

// Remove stale temp files under dir; returns removed relative paths.
export function cleanStaleTemps(dir, maxAgeMs = 3600_000, nowMs = Date.now()) {
  const removed = []
  if (!existsSync(dir)) return removed
  cleanWalk(dir, dir, maxAgeMs, nowMs, removed)
  return removed
}

function cleanWalk(root, dir, maxAgeMs, nowMs, removed) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const p = join(dir, name)
    let st
    try {
      st = lstatSync(p)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) {
      cleanWalk(root, p, maxAgeMs, nowMs, removed)
      continue
    }
    if (!st.isFile()) continue
    if (!name.includes('.sync-tmp-')) continue
    if (st.mtimeMs >= nowMs - maxAgeMs) continue
    try {
      unlinkSync(p)
      removed.push(relative(root, p).split(sep).join('/'))
    } catch { /* ignore */ }
  }
}

// Discover client folders from the mirror's top-level directories.
export function defaultClientFolders(mirrorRoot) {
  if (!existsSync(mirrorRoot)) return []
  let entries
  try {
    entries = readdirSync(mirrorRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.name === 'Music' || e.name === '_shared') continue
    if (!e.isDirectory()) continue
    out.push(e.name)
  }
  return out.sort()
}

// Parse CLI arguments.
export function parseArgs(argv) {
  const args = { apply: false, source: null, mirror: null, clients: null }
  for (let i = 0; i < (argv ?? []).length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--check') args.apply = false
    else if (a === '--source') args.source = argv[++i]
    else if (a === '--mirror') args.mirror = argv[++i]
    else if (a === '--clients') {
      args.clients = String(argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    } else {
      throw new Error('unknown argument: ' + a)
    }
  }
  return args
}

// Resolve source/mirror roots and refuse if they overlap.
function resolveRoots(args, env) {
  const sourceRoot = resolve(args.source ?? env.STUDIO_SOURCE_ROOT ?? join(homedir(), 'Dropbox/MagicLab_Studio'))
  const mirrorRoot = resolve(args.mirror ?? env.STUDIO_MIRROR_ROOT ?? join(homedir(), 'Library/Application Support/magicengine/studio'))
  return { sourceRoot, mirrorRoot }
}

function rootsOverlap(sourceRoot, mirrorRoot) {
  const rs = realpathSync(sourceRoot)
  const rm = realpathSync(mirrorRoot)
  return rs === rm || rm.startsWith(rs + sep) || rs.startsWith(rm + sep)
}

// Log one scope's plan lines.
function logPlan(plan, log) {
  if (plan.missingSource) {
    log(`${plan.scope}: 源目录没有，跳过`)
    return
  }
  log(`${plan.scope}: 要补 ${plan.copy.length} · 内容相同只对齐时间 ${plan.touch.length} · 镜像较新未覆盖 ${plan.conflicts.length} · 只在镜像里 ${plan.onlyInMirror.length}`)
  for (const item of plan.copy) log(`  + ${item.rel} (${item.reason})`)
  for (const c of plan.conflicts) {
    if (c.reason === 'add_only_scope') {
      log(`  ! ${c.rel} 配乐只补新文件，不覆盖已有的（出片机人声检查读的是镜像里这份）`)
    } else {
      log(`  ! ${c.rel} 镜像里的版本更新，没覆盖`)
    }
  }
  for (const rel of plan.onlyInMirror) log(`  ? ${rel} 只在镜像里（不删）`)
}

// True when a plan indicates the source could not be read.
function isSourceFailure(plan) {
  return plan.sourceErrors.length > 0 || (plan.missingSource && plan.mirrorHasFiles)
}

// Log a source failure for one plan.
function logSourceFailure(plan, log) {
  log(`  x ${plan.scope}: 源目录读不到（Dropbox 没挂上、没授权或软链断了）`)
  for (const e of plan.sourceErrors) log(`    ${e.path}: ${e.error}`)
}

// Clean stale temp files for each scope's mirror dir (apply mode only).
function cleanScopeTemps({ mirrorRoot, scopes, log }) {
  for (const scope of scopes) {
    const dir = join(mirrorRoot, scope)
    if (!existsSync(dir)) continue
    for (const rel of cleanStaleTemps(dir)) log(`  - 清掉残留临时文件 ${rel}`)
  }
}

// CLI entry point.
export async function run({ argv = process.argv.slice(2), env = process.env, log = console.log, now = new Date() } = {}) {
  const args = parseArgs(argv)
  const { sourceRoot, mirrorRoot } = resolveRoots(args, env)
  if (!existsSync(sourceRoot)) {
    log('源目录不存在：' + sourceRoot)
    return 2
  }
  if (!existsSync(mirrorRoot)) {
    log('镜像目录不存在：' + mirrorRoot)
    return 2
  }
  if (rootsOverlap(sourceRoot, mirrorRoot)) {
    log('源目录和镜像目录互相包含，拒绝运行')
    return 2
  }
  const clients = args.clients ?? defaultClientFolders(mirrorRoot)
  const badClient = clients.find((c) => !SAFE_FOLDER.test(c))
  if (badClient !== undefined) {
    log('客户文件夹名不合法（只许字母数字和 ._-）：' + badClient)
    return 2
  }
  const scopes = scopesFor(clients)
  if (args.apply) cleanScopeTemps({ mirrorRoot, scopes, log })
  const manifestByPath = readManifestByPath(mirrorRoot)
  const plans = []
  let needCopy = 0
  let touchCount = 0
  let conflicts = 0
  let onlyInMirror = 0
  let sourceFailed = 0
  for (const scope of scopes) {
    const plan = await planScope({ sourceRoot, mirrorRoot, scope, manifestByPath })
    plans.push(plan)
    if (isSourceFailure(plan)) {
      sourceFailed++
      logSourceFailure(plan, log)
    } else {
      logPlan(plan, log)
    }
    needCopy += plan.copy.length
    touchCount += plan.touch.length
    conflicts += plan.conflicts.length
    onlyInMirror += plan.onlyInMirror.length
  }
  const copied = []
  const touched = []
  const failed = []
  if (args.apply) {
    for (const plan of plans) {
      if (plan.copy.length === 0 && plan.touch.length === 0) continue
      const r = applyScope(plan, mirrorRoot)
      copied.push(...r.copied)
      touched.push(...r.touched)
      failed.push(...r.failed)
      for (const f of r.failed) log(`  x ${f.rel}: ${f.error}`)
    }
    if (copied.length > 0 || touched.length > 0 || !existsSync(join(mirrorRoot, MANIFEST_NAME))) {
      await rebuildManifest({ mirrorRoot, scopes, copiedPaths: copied, now })
    }
  }
  log(JSON.stringify({
    event: 'studio_mirror_sync',
    mode: args.apply ? 'apply' : 'check',
    at: now.toISOString(),
    need_copy: needCopy,
    copied: copied.length,
    touch_only: touchCount,
    touched: touched.length,
    failed: failed.length,
    conflicts,
    only_in_mirror: onlyInMirror,
    source_failed: sourceFailed,
  }))
  if (sourceFailed > 0) return 1
  if (args.apply) return failed.length > 0 ? 1 : 0
  return needCopy > 0 || conflicts > 0 ? 1 : 0
}

// Only run when executed directly.
const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  run()
    .then((code) => { process.exitCode = code })
    .catch((err) => { console.error(err); process.exitCode = 1 })
}
