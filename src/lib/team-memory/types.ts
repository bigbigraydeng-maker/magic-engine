/**
 * Team Working Memory — 共享类型
 *
 * 背景见 supabase/migrations/20260802090000_team_memory.sql 顶部注释。
 */

/** 归一化后的项目名。worktree 一律归到父项目。 */
export type ProjectKey =
  | 'magic-engine'
  | 'chinatravel'
  | 'midashand'
  | 'magic-lab-academy'
  | 'unknown'

/** PM 拍板的两格：project = 只在这个项目提醒，global = 哪儿都提醒 */
export type LessonScope = 'project' | 'global'

/**
 * 硬证据类型。PM 选了「全自动入库」，所以这是唯一的闸门。
 * 注意这里**没有** 'claude_said_done' —— 那不是证据。
 */
export type EvidenceKind =
  | 'user_correction' // PM 当场纠正过我，最强信号
  | 'merged' // 改动真的合进 main 了
  | 'tests_passed' // 测试真的跑过了
  | 'multi_session' // 同一现象在 >=2 个独立会话里重现

export type WorkEventKind = 'tool' | 'error' | 'correction' | 'test' | 'git' | 'note'

/** hook 上报的单条事件（已在本机脱敏一次，服务端会再脱一次） */
export interface WorkEventInput {
  seq: number
  kind: WorkEventKind
  tool_name?: string | null
  summary: string
  target?: string | null
  ok?: boolean | null
  occurred_at?: string
}

/** hook 在会话结束时上报的整包 */
export interface SessionIngestInput {
  session_key: string
  project_key: ProjectKey
  cwd?: string | null
  git_branch?: string | null
  git_head?: string | null
  goal?: string | null
  status?: 'active' | 'ended'
  files_changed?: string[]
  commit_shas?: string[]
  pr_number?: number | null
  commands_run?: number
  tests_passed?: boolean | null
  tests_failed?: boolean | null
  user_corrections?: number
  started_at?: string | null
  ended_at?: string | null
  events?: WorkEventInput[]
}

export interface TeamLesson {
  id: string
  lesson_key: string
  scope: LessonScope
  project_key: string | null
  title: string
  lesson: string
  rationale: string | null
  evidence_kind: EvidenceKind
  evidence: Record<string, unknown>
  confidence: number
  confirmed_count: number
  contradicted_count: number
  source: 'auto_distill' | 'imported_memory' | 'manual'
  is_active: boolean
  last_confirmed_at: string
}

export interface SkillStep {
  step: number
  action: string
  why?: string
}

export interface TeamSkill {
  id: string
  skill_key: string
  scope: LessonScope
  project_key: string | null
  name: string
  description: string
  preconditions: string[]
  procedure: SkillStep[]
  success_criteria: string[]
  stop_conditions: string[]
  /**
   * 步骤里有花钱 / 对外发布 / 难撤回动作。
   * 套路自动上线，但这类步骤执行时仍要 PM 显式 go —— 现有闸门一根不拆。
   */
  requires_approval: boolean
  status: 'active' | 'retired'
  use_count: number
  success_count: number
  fail_count: number
}

/** 新窗口开启时注入的内容 */
export interface SessionContextPayload {
  project_key: ProjectKey
  lessons: Pick<
    TeamLesson,
    'title' | 'lesson' | 'scope' | 'evidence_kind' | 'last_confirmed_at' | 'source'
  >[]
  skills: Pick<TeamSkill, 'skill_key' | 'name' | 'description' | 'requires_approval'>[]
  /** 上一次同项目会话的交接摘要，换窗口不用 PM 人工传「咒语」 */
  handoff: {
    session_key: string
    goal: string | null
    git_branch: string | null
    summary: string | null
    ended_at: string | null
  } | null
}
