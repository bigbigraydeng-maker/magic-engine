import type { AgentStatus } from './types'

export interface ReadmeAgentRow {
  nameZh: string; code: string; group: string; status: AgentStatus
  profileRaw: string; playbooksRaw: string
}

export interface ReadmeOwnershipRow { playbooksRaw: string; ownerRaw: string }

export interface ReadmeParse {
  agents: ReadmeAgentRow[]; ownership: ReadmeOwnershipRow[]; skippedLines: number
}

const MD_REF_RE = /[^\s()[\]`|<>"']+\.md/g

export function extractMdRefs(cell: string): string[] {
  return Array.from(new Set(cell.match(MD_REF_RE) ?? []))
}

export function normalizeStatus(text: string): AgentStatus {
  if (/已撤|撤销|retired/i.test(text)) return 'retired'
  if (/名单外|待\s*PM\s*定|outside/i.test(text)) return 'outside'
  return 'active'
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

const isSeparator = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

interface Table { header: string[]; rows: string[][]; skipped: number }

function collectTables(text: string): Table[] {
  const lines = text.split(/\r?\n/)
  const tables: Table[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|') || !isSeparator(lines[i + 1])) continue
    const header = splitRow(lines[i])
    const table: Table = { header, rows: [], skipped: 0 }
    let j = i + 2
    for (; j < lines.length && lines[j].includes('|'); j++) {
      const cells = splitRow(lines[j])
      if (cells.length < header.length) table.skipped++
      else table.rows.push(cells)
    }
    tables.push(table)
    i = j
  }
  return tables
}

const findCol = (header: string[], re: RegExp): number => header.findIndex((h) => re.test(h))
const clean = (s: string): string => s.replace(/[*`]/g, '').trim()

function parseAgentTable(t: Table): ReadmeAgentRow[] | null {
  const name = findCol(t.header, /中文名|名称|姓名|名字|^agent$/i)
  const profile = findCol(t.header, /档案|profile/i)
  if (name < 0 || profile < 0) return null
  const code = findCol(t.header, /代号|code|拼音/i)
  const group = findCol(t.header, /分组|类别|§|^组/)
  const status = findCol(t.header, /状态/)
  const playbooks = findCol(t.header, /手册|sop|playbook/i)
  const cell = (r: string[], c: number): string => (c >= 0 ? r[c] ?? '' : '')
  return t.rows.map((r) => ({
    nameZh: clean(cell(r, name)),
    code: clean(cell(r, code)),
    group: clean(cell(r, group)),
    status: normalizeStatus(`${cell(r, status)} ${cell(r, name)}`),
    profileRaw: cell(r, profile),
    playbooksRaw: playbooks === profile ? '' : cell(r, playbooks),
  }))
}

function parseOwnershipTable(t: Table): ReadmeOwnershipRow[] | null {
  const pb = findCol(t.header, /手册|sop|playbook/i)
  const owner = findCol(t.header, /归属|负责|管理|owner|agent/i)
  if (pb < 0 || owner < 0 || pb === owner) return null
  return t.rows.map((r) => ({ playbooksRaw: r[pb] ?? '', ownerRaw: r[owner] ?? '' }))
}

export function parseReadme(text: string): ReadmeParse {
  const out: ReadmeParse = { agents: [], ownership: [], skippedLines: 0 }
  for (const t of collectTables(text)) {
    out.skippedLines += t.skipped
    const agents = parseAgentTable(t)
    if (agents) {
      out.agents.push(...agents.filter((a) => a.nameZh !== ''))
      continue
    }
    const own = parseOwnershipTable(t)
    if (own) out.ownership.push(...own)
  }
  return out
}
