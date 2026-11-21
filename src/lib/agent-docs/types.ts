export type DocKind = 'agents' | 'sops' | 'playbooks' | 'registry'
export type AgentStatus = 'active' | 'retired' | 'outside'

export interface DocRef { kind: DocKind; file: string }

export interface AgentRuleRef {
  source: string
  count: string
  inPrompt: string
  verified: string
  doc: DocRef | null
}

export interface AgentRow {
  key: string; nameZh: string; code: string; group: string; status: AgentStatus
  profile: DocRef | null; playbooks: DocRef[]; warnings: string[]
  rules: AgentRuleRef[]
}

export interface AgentCatalog {
  rows: AgentRow[]
  readmeMissing: boolean
  allowed: Set<string>
  notes: string[]
  /** False when the rules index is missing or its table cannot be read. The page then keeps the old columns. */
  rulesOk: boolean
  rulesNotice: string | null
}

export const docKey = (ref: DocRef): string => `${ref.kind}/${ref.file}`
