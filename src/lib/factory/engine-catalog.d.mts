export const ENGINE_CATALOG_ID: string
export const REQUIRED_ENGINE_CAPABILITIES: readonly string[]
export const ENGINE_UPDATE_MESSAGE: string

export interface EngineReportOk {
  ok: true
  engine_rev: string
  catalog_id: string
  capabilities: string[]
}

export interface EngineReportStale {
  ok: false
  message: string
  engine_rev: string | null
}

export function assessEngineReport(raw: unknown): EngineReportOk | EngineReportStale

export interface EnginePing {
  summary?: {
    client_ids?: string[] | null
    engine_stale?: boolean
    engine_notice?: string
  } | null
}

export function engineStaleNotice(pings: readonly EnginePing[], clientId?: string): string | null
export function engineCardNote(output: unknown): string | null
