/**
 * Read model for the ads-health "多维数据" tab: what the page may show from `ad_breakdown_stats`
 * plus CRM form leads. Read-only; nothing here writes anywhere.
 *
 * Denominator rule (playbook §四十一): lead metrics only count spend of campaigns whose objective
 * produces form leads. Spend of other objectives (messaging, video views, traffic) is listed apart,
 * never mixed into cost per lead.
 */

/** Objectives whose ads collect instant-form leads. */
export const LEAD_OBJECTIVES: readonly string[] = ['OUTCOME_LEADS', 'LEAD_GENERATION']

/** Rough screen of one row against the rest of its table. Not a statistical verdict. */
export type RowFlag = 'costly' | 'cheap' | 'normal' | 'too_few'

/** One row of a breakdown table, restricted to lead-objective campaigns. */
export interface ReportRow {
  key: string
  spend: number
  impressions: number
  clicks: number
  /** Leads used for cost per lead: CRM form leads for hour/weekday, Meta-reported leads for others. null = no lead source for this cut. */
  leads: number | null
  costPerLead: number | null
  /** Leads this row would get at the table-wide leads-per-dollar rate. null when leads is null. */
  expectedLeads: number | null
  flag: RowFlag | null
  spendShare: number
}

export interface NonLeadSpend {
  objective: string
  spend: number
}

export interface ReportAccount {
  adAccountId: string
  currency: string | null
  timezone: string | null
  latestStatDate: string | null
  lastFetchedAt: string | null
}

export interface BreakdownReport {
  window: { since: string; until: string; days: number }
  accounts: ReportAccount[]
  totals: {
    /** All spend in the window, every objective. */
    spendAll: number
    /** Spend of lead-objective campaigns only (the cost-per-lead denominator). */
    spendLeadObjective: number
    metaLeads: number
    crmLeads: number
    /** crmLeads / metaLeads; null when metaLeads is 0. */
    matchRate: number | null
    costPerCrmLead: number | null
  }
  nonLeadSpend: NonLeadSpend[]
  /** key = '0'..'23', account-timezone hour; leads = CRM form leads by submission hour in the ad's account timezone. */
  hour: ReportRow[]
  /** key = '1'..'7' (Mon..Sun); leads = CRM form leads. */
  weekday: ReportRow[]
  /** key = 'platform · position'; leads = Meta-reported. */
  placement: ReportRow[]
  /** key = device; leads = Meta-reported. */
  device: ReportRow[]
  /** key = 'age · gender'; leads = Meta-reported. */
  ageGender: ReportRow[]
  /** key = region; Meta gives no leads for region, so leads/costPerLead/expectedLeads/flag are null. Top 15 by spend. */
  region: ReportRow[]
}

export const REPORT_DEFAULT_DAYS = 90
export const REPORT_MAX_DAYS = 180
/** A row needs at least this many expected leads before it is flagged at all. */
export const FLAG_MIN_EXPECTED = 5
/** |z| above this marks a row costly / cheap. */
export const FLAG_Z = 2
export const REGION_TOP_N = 15
