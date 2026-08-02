/**
 * 楼盘（中介名下的开发项目）读写层 —— Magic Engine 海外地产版独有（2026-08-03）。
 *
 * PM 拍板：客户 = 中介，楼盘是中介名下的项目，发票直接开给楼盘开发商。
 * 每个楼盘各带自己的定位、策略、素材 —— 不同楼盘的人群、价格带、卖点完全不同。
 *
 * 🔴 每个函数都恒带 client_id：楼盘 id 是 uuid，但拿别的中介的楼盘 id 过来
 *    照样能改 —— 除非查询本身把中介锁死。这不是多余的保险，是唯一的保险。
 */

import { supabaseAdmin } from '@/lib/supabase'

export const PROJECT_STATUSES = ['active', 'paused', 'completed', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '在售',
  paused: '暂停',
  completed: '售罄',
  archived: '归档',
}

export interface ClientProject {
  id: string
  client_id: string
  name: string
  status: ProjectStatus
  invoice_to_name: string | null
  invoice_to_contact: string | null
  invoice_to_email: string | null
  brief: Record<string, unknown>
  merged_from_client_id: string | null
  created_at: string
  updated_at: string
}

/** 建楼盘 / 改楼盘时允许写的字段。id、client_id 不在其中 —— 归属不给改。 */
export interface ProjectInput {
  name?: string
  status?: ProjectStatus
  invoice_to_name?: string | null
  invoice_to_contact?: string | null
  invoice_to_email?: string | null
  note?: string | null
}

export function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === 'string' && (PROJECT_STATUSES as readonly string[]).includes(v)
}

/**
 * 把外部传入的内容收敛成可写字段。
 *
 * 名字空白直接判非法（不是静默存空字符串）—— 楼盘没名字后面全乱套：
 * 素材归属、开票、报告标题全靠它。
 */
export function normaliseProjectInput(body: unknown): { ok: true; value: ProjectInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求内容不是对象' }
  const b = body as Record<string, unknown>
  const out: ProjectInput = {}

  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) return { ok: false, error: '楼盘名字不能为空' }
    if (name.length > 120) return { ok: false, error: '楼盘名字过长（上限 120 字）' }
    out.name = name
  }

  if (b.status !== undefined) {
    if (!isProjectStatus(b.status)) return { ok: false, error: '未知的楼盘状态' }
    out.status = b.status
  }

  // 开票信息允许留空 —— 建档时通常还没谈定开发商那边的对接人
  for (const k of ['invoice_to_name', 'invoice_to_contact', 'invoice_to_email'] as const) {
    if (b[k] !== undefined) {
      const v = typeof b[k] === 'string' ? (b[k] as string).trim() : ''
      out[k] = v || null
    }
  }

  if (b.note !== undefined) {
    out.note = typeof b.note === 'string' ? b.note.trim() || null : null
  }

  return { ok: true, value: out }
}

export async function listProjects(clientId: string): Promise<ClientProject[]> {
  const { data, error } = await supabaseAdmin
    .from('client_projects')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ClientProject[]
}

export async function createProject(clientId: string, input: ProjectInput): Promise<ClientProject> {
  const { note, ...rest } = input
  const { data, error } = await supabaseAdmin
    .from('client_projects')
    .insert({
      client_id: clientId,
      ...rest,
      brief: note ? { note } : {},
    })
    .select('*')
    .single()

  if (error) {
    // 23505 = 同一中介下重名。说人话，别把数据库错误原样丢给运营。
    if (error.code === '23505') throw new Error('这个中介名下已经有同名楼盘了')
    throw new Error(error.message)
  }
  return data as ClientProject
}

export async function updateProject(
  clientId: string,
  projectId: string,
  input: ProjectInput,
): Promise<ClientProject | null> {
  const { note, ...rest } = input
  const patch: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() }
  if (note !== undefined) patch.brief = note ? { note } : {}

  const { data, error } = await supabaseAdmin
    .from('client_projects')
    .update(patch)
    .eq('id', projectId)
    .eq('client_id', clientId) // 恒带：否则别家中介的楼盘 id 传过来照样能改
    .select('*')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') throw new Error('这个中介名下已经有同名楼盘了')
    throw new Error(error.message)
  }
  return (data as ClientProject | null) ?? null
}

/** 每个楼盘挂了多少套房 —— 楼盘下面没房源说明还没建档完。 */
export async function countProjectListings(clientId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const { data } = await supabaseAdmin
    .from('listings')
    .select('project_id')
    .eq('client_id', clientId)
    .not('project_id', 'is', null)
  for (const row of data ?? []) {
    const pid = (row as { project_id: string }).project_id
    counts[pid] = (counts[pid] ?? 0) + 1
  }
  return counts
}

/** 每个楼盘挂了多少素材 —— 界面上要让人一眼看出哪个楼盘还没料。 */
export async function countProjectAssets(clientId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of ['client_assets', 'video_clips'] as const) {
    const { data } = await supabaseAdmin
      .from(table)
      .select('project_id')
      .eq('client_id', clientId)
      .not('project_id', 'is', null)
    for (const row of data ?? []) {
      const pid = (row as { project_id: string }).project_id
      counts[pid] = (counts[pid] ?? 0) + 1
    }
  }
  return counts
}
