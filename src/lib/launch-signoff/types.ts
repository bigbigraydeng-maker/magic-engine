/**
 * 上线签字 —— 类型。设计：docs/specs/2026-10-19-launch-signoff-design-v0.2.md
 * 全部是纯类型，不含运行时代码，也不含任何金额/钥匙。
 */

export type EventType = 'item_result' | 'review' | 'halt' | 'unlock' | 'signature' | 'revoke'
export type ActorRole = 'executor' | 'reviewer' | 'human'
export type ResultStatus = 'pass' | 'fail'

/** 表里的一行（snake_case → camelCase）。 */
export interface LaunchEvent {
  readonly id: number
  readonly featureKey: string
  readonly eventType: EventType
  readonly itemKey: string | null
  readonly status: ResultStatus | null
  readonly evidenceRef: Record<string, unknown> | null
  readonly evidenceSnapshot: Record<string, unknown> | null
  readonly refEventId: number | null
  readonly actor: string
  readonly actorRole: ActorRole
  readonly commitSha: string | null
  readonly checklistHash: string
  readonly note: string | null
  readonly createdAt: string
}

/** 清单里的一项（手写的结构化定义，不从 markdown 解析）。 */
export interface ChecklistItem {
  readonly key: string
  readonly title: string
  /** 这一项要证明什么 */
  readonly goal: string
  /** 通过判据（必须是真实记录） */
  readonly passCriteria: string
  /** 怎么做 */
  readonly how: string
  readonly owner: string
  /** 服务端能回读生产库核对证据（false = 只能“人工确认”，页面会标出来） */
  readonly machineVerifiable: boolean
  /** 失败即停：写 halt 锁住整份清单，不得重试 */
  readonly haltOnFail: boolean
  /** 必须与该项使用同一条动作记录（run id）的其它项 */
  readonly sameRunAs?: string
  /** 人工确认项的 recordRef.table 只许是这些表（把证据和具体哪一项绑上） */
  readonly evidenceTables?: readonly string[]
}

/** 证据回读的“对的那一行”约束：哪个客户、本轮从什么时候开始（更早的历史记录不算）。随指纹一起，改了旧签作废。 */
export interface EvidencePolicy {
  readonly targetClientId: string
  readonly roundStartedAt: string
}

export interface Checklist {
  readonly featureKey: string
  readonly title: string
  readonly riskLevel: 'A'
  /** 对应的仓库文档（人读的版本） */
  readonly docPath: string
  /** 只证明什么、不证明什么 —— 页头常驻 */
  readonly scopeNote: string
  readonly evidencePolicy: EvidencePolicy
  readonly items: readonly ChecklistItem[]
}

export type ItemStatus = 'untested' | 'pending_review' | 'passed' | 'failed' | 'locked'

export interface ItemView {
  readonly key: string
  readonly status: ItemStatus
  readonly resultEventId: number | null
  readonly reviewEventId: number | null
  readonly commitSha: string | null
  /** 人工确认（没有机器回读）的项 */
  readonly manual: boolean
  /** 人工确认项：执行方写的原文 + 指向的库表记录，签字人要看到 */
  readonly manualDescription: string | null
  readonly manualRecord: string | null
  readonly resultNote: string | null
  readonly reviewNote: string | null
  readonly resultActor: string | null
  readonly reviewActor: string | null
  readonly at: string | null
}

export interface SignatureView {
  readonly eventId: number
  readonly signedBy: string
  readonly signedAt: string
  readonly commitSha: string
  /** 仍然有效：未撤销、清单指纹未变、线上提交号与签字时一致 */
  readonly valid: boolean
  readonly invalidReason: string | null
}

export interface DerivedState {
  readonly featureKey: string
  readonly checklistHash: string
  /** 事件水位（最大事件 id）；签字请求带它，对不上就拒签 */
  readonly watermark: number
  readonly halted: boolean
  readonly haltNote: string | null
  readonly items: readonly ItemView[]
  /** 能不能点“签字上线” */
  readonly signable: boolean
  /** 为什么不能（人话，已排好）；signable 时为空 */
  readonly blockers: readonly string[]
  readonly signature: SignatureView | null
  readonly currentCommit: string | null
}
