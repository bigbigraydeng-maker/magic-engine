export type DocKind = 'agents' | 'sops'
export type AgentStatus = 'active' | 'retired' | 'outside'

export interface DocRef { kind: DocKind; file: string }

export interface AgentRow {
  key: string; nameZh: string; code: string; group: string; status: AgentStatus; summary: string
  profile: DocRef | null; playbooks: DocRef[]; warnings: string[]
}

export interface AgentCatalog {
  rows: AgentRow[]
  readmeMissing: boolean
  allowed: Set<string>
  notes: string[]
}

export const docKey = (ref: DocRef): string => `${ref.kind}/${ref.file}`
