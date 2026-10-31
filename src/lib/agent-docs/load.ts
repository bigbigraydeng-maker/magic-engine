import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { extractMdRefs, parseReadme, parseRulesIndex, type ReadmeAgentRow, type ReadmeParse, type RulesIndexRow } from './parse-readme'
import { docKey, type AgentCatalog, type AgentRow, type AgentRuleRef, type DocKind, type DocRef } from './types'

export const AGENTS_DIR = 'docs/agents'
export const README_FILE = 'README.md'
const PROFILE_FILE_RE = /^(\d{2})-([a-z0-9]+)\.md$/
const FILE_NAME_RE = /^[^/\\]+\.md$/
const FLAT_KINDS = new Set<DocKind>(['agents', 'sops'])
const TREE_KINDS = new Set<DocKind>(['playbooks', 'registry'])
const RULES_INDEX = 'platform-rules-index.md'
const RULES_NOTICE = '规则总索引读不到或表头对不上，下面仍是原来的名单。'

type Exists = (kind: DocKind, file: string) => boolean

export function isSafeDocFile(file: string): boolean {
  if (!file.endsWith('.md') || file.includes('\\')) return false
  const parts = file.split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}

export function resolveDocRef(raw: string, exists: Exists): DocRef | null {
  const p = raw.split('#')[0].trim().replace(/^\.\//, '').replace(/^(\.\.\/)+/, '').replace(/^docs\//, '')
  const parts = p.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  if (parts.length === 1 && FILE_NAME_RE.test(p)) {
    if (exists('agents', p)) return { kind: 'agents', file: p }
    return exists('sops', p) ? { kind: 'sops', file: p } : { kind: 'agents', file: p }
  }
  const kind = parts[0] as DocKind
  const file = parts.slice(1).join('/')
  if (!isSafeDocFile(file)) return null
  if (FLAT_KINDS.has(kind) && parts.length === 2) return { kind, file }
  if (TREE_KINDS.has(kind)) return { kind, file }
  return null
}

function dedupe(refs: DocRef[]): DocRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => (seen.has(docKey(r)) ? false : (seen.add(docKey(r)), true)))
}

function refsFromCell(cell: string, exists: Exists, notes: string[]): DocRef[] {
  const refs: DocRef[] = []
  for (const raw of extractMdRefs(cell)) {
    const ref = resolveDocRef(raw, exists)
    if (ref) refs.push(ref)
    else notes.push(`对照表里的「${raw}」不在开放范围内（只开放档案与通用手册），已忽略`)
  }
  return refs
}

function readTextOrNull(root: string, kind: DocKind, file: string): string | null {
  try { return readFileSync(join(root, 'docs', kind, file), 'utf8') } catch { return null }
}

function rowFromProfile(root: string, file: string, exists: Exists, notes: string[]): AgentRow {
  const m = PROFILE_FILE_RE.exec(file)
  const text = readTextOrNull(root, 'agents', file)
  const lines = (text ?? '').split(/\r?\n/)
  const title = lines.find((l) => l.startsWith('# ')) ?? ''
  const nameZh = title.replace(/^#\s*/, '').split(/\s[—-]\s/)[0].trim() || (m ? m[2] : file)
  const head = lines.slice(0, 15).join('\n')
  const status = /已撤/.test(head) ? 'retired' : /名单外/.test(head) ? 'outside' : 'active'
  const start = lines.findIndex((l) => /^#{2,}\s.*操作手册/.test(l))
  let section = ''
  if (start >= 0) {
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((l) => /^#{1,3}\s/.test(l))
    section = (end >= 0 ? rest.slice(0, end) : rest).join('\n')
  }
  const row: AgentRow = {
    key: m ? m[2] : file, nameZh, code: m ? m[2] : '', group: '待补', status,
    profile: { kind: 'agents', file }, playbooks: dedupe(refsFromCell(section, exists, notes)), warnings: [],
    rules: [],
  }
  if (text === null) row.warnings.push('档案文件读不到')
  if (start < 0) row.warnings.push('档案末尾没有「操作手册」一节，管哪些手册待补')
  return row
}

export function ownerMatchesAgent(owner: string, nameZh: string, code: string): boolean {
  const o = owner.toLowerCase()
  return (nameZh !== '' && owner.includes(nameZh)) || (code !== '' && o.includes(code.toLowerCase()))
}

function ownerMatches(owner: string, row: ReadmeAgentRow): boolean {
  return ownerMatchesAgent(owner, row.nameZh, row.code)
}

function rowFromReadme(r: ReadmeAgentRow, parse: ReadmeParse, exists: Exists, notes: string[]): AgentRow {
  const profile = refsFromCell(r.profileRaw, exists, notes)[0] ?? null
  const fromOwnership = parse.ownership
    .filter((o) => ownerMatches(o.ownerRaw, r))
    .flatMap((o) => refsFromCell(o.playbooksRaw, exists, notes))
  const playbooks = dedupe([...refsFromCell(r.playbooksRaw, exists, notes), ...fromOwnership])
  const warnings: string[] = []
  if (!profile) warnings.push('对照表没写档案文件')
  if (r.group === '') warnings.push('分组待补')
  return {
    key: r.code || r.nameZh, nameZh: r.nameZh, code: r.code, group: r.group || '待补', status: r.status,
    profile, playbooks, warnings, rules: [],
  }
}

function listProfileFiles(root: string): string[] {
  try {
    return readdirSync(join(root, AGENTS_DIR)).filter((f) => PROFILE_FILE_RE.test(f) && !f.startsWith('00-')).sort()
  } catch { return [] }
}

function splitDocKey(key: string): [DocKind, string] {
  const cut = key.indexOf('/')
  return [key.slice(0, cut) as DocKind, key.slice(cut + 1)]
}

function allowMarkdownTree(root: string, kind: 'playbooks' | 'registry', allowed: Set<string>): void {
  const walk = (dir: string, prefix: string): void => {
    let entries: Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (entry.isFile() && isSafeDocFile(rel)) allowed.add(`${kind}/${rel}`)
    }
  }
  walk(join(root, 'docs', kind), '')
}

function ruleDoc(pathRaw: string, exists: Exists): DocRef | null {
  const raw = extractMdRefs(pathRaw)[0]
  if (!raw) return null
  const ref = resolveDocRef(raw, exists)
  return ref && (ref.kind === 'playbooks' || ref.kind === 'registry' || ref.kind === 'sops' || ref.kind === 'agents') ? ref : null
}

function attachRules(rows: AgentRow[], indexRows: RulesIndexRow[], exists: Exists): void {
  for (const row of rows) {
    row.rules = indexRows.filter((rule) => ownerMatchesAgent(rule.owner, row.nameZh, row.code)).map((rule): AgentRuleRef => ({
      source: rule.source, count: rule.count, inPrompt: rule.inPrompt, verified: rule.verified,
      doc: ruleDoc(rule.pathRaw, exists),
    }))
  }
}

function markMissingFiles(root: string, rows: AgentRow[], allowed: Set<string>, notes: string[]): void {
  for (const ref of Array.from(allowed)) {
    const [kind, file] = splitDocKey(ref)
    if (!isSafeDocFile(file) || !existsSync(join(root, 'docs', kind, file))) notes.push(`对照表列了「${ref}」，但仓库里找不到这个文件`)
  }
  for (const row of rows) {
    const missing = [row.profile, ...row.playbooks].filter(
      (r): r is DocRef => r !== null && !existsSync(join(root, 'docs', r.kind, r.file)),
    )
    for (const m of missing) row.warnings.push(`文件缺失：${m.file}`)
  }
}

export function buildCatalog(root: string = process.cwd()): AgentCatalog {
  const notes: string[] = []
  const exists: Exists = (kind, file) => existsSync(join(root, 'docs', kind, file))
  const readme = readTextOrNull(root, 'agents', README_FILE)
  const parse = readme === null ? null : parseReadme(readme)
  const rows: AgentRow[] = (parse?.agents ?? []).map((r) => rowFromReadme(r, parse as ReadmeParse, exists, notes))
  const readmeMissing = rows.length === 0
  if (readme === null) notes.push('docs/agents/README.md 读不到，对照表改为逐份读取档案；管哪些手册可能不全')
  else if (readmeMissing) notes.push('README 里没认出名单与对照表，改为逐份读取档案')
  if (parse && parse.skippedLines > 0) notes.push(`README 表格有 ${parse.skippedLines} 行格式对不上，已跳过`)
  const listed = new Set(rows.map((r) => r.profile?.file).filter(Boolean))
  for (const file of listProfileFiles(root)) {
    if (listed.has(file)) continue
    const row = rowFromProfile(root, file, exists, notes)
    if (!readmeMissing) row.warnings.push('README 对照表没列这位')
    rows.push(row)
  }
  const allowed = new Set<string>()
  for (const row of rows) for (const ref of [row.profile, ...row.playbooks]) if (ref) allowed.add(docKey(ref))
  markMissingFiles(root, rows, allowed, notes)
  allowMarkdownTree(root, 'playbooks', allowed)
  allowMarkdownTree(root, 'registry', allowed)
  const rules = readRules(root)
  if (rules.ok) attachRules(rows, rules.rows, exists)
  openListedRuleDocs(root, rows, allowed)
  return {
    rows, readmeMissing, allowed, notes: Array.from(new Set(notes)),
    rulesOk: rules.ok, rulesNotice: rules.ok ? null : RULES_NOTICE,
  }
}

function readRules(root: string): { ok: true; rows: RulesIndexRow[] } | { ok: false } {
  const text = readTextOrNull(root, 'registry', RULES_INDEX)
  if (text === null) return { ok: false }
  const parsed = parseRulesIndex(text)
  if (!parsed || parsed.skippedLines > 0 || parsed.rows.length === 0) return { ok: false }
  return { ok: true, rows: parsed.rows }
}

function openListedRuleDocs(root: string, rows: AgentRow[], allowed: Set<string>): void {
  for (const row of rows) for (const rule of row.rules) {
    const ref = rule.doc
    if (!ref || !isSafeDocFile(ref.file)) continue
    if (existsSync(join(root, 'docs', ref.kind, ref.file))) allowed.add(docKey(ref))
  }
}

export type DocRead = { ok: true; text: string } | { ok: false; reason: 'not_allowed' | 'unreadable' }

export function readAllowedDoc(catalog: AgentCatalog, kind: string, file: string, root: string = process.cwd()): DocRead {
  if (!isSafeDocFile(file) || !catalog.allowed.has(`${kind}/${file}`)) return { ok: false, reason: 'not_allowed' }
  const text = readTextOrNull(root, kind as DocKind, file)
  return text === null ? { ok: false, reason: 'unreadable' } : { ok: true, text }
}
