export type DocKind = 'agents' | 'sops'
export type AgentStatus = 'active' | 'retired' | 'outside'

export interface DocRef {
  kind: DocKind
  file: string
}

export interface AgentRow {
  key: string
  nameZh: string
  code: string
  group: string
  status: AgentStatus
  profile: DocRef | null
  playbooks: DocRef[]
  warnings: string[]
}

export interface AgentCatalog {
  rows: AgentRow[]
  /** true when docs/agents/README.md was missing or yielded no rows */
  readmeMissing: boolean
  /** Whitelist of openable files, keyed `${kind}/${file}` */
  allowed: Set<string>
  /** Catalog-level notes (unreadable files, rows that did not parse) */
  notes: string[]
}

export const docKey = (ref: DocRef): string => `${ref.kind}/${ref.file}`
