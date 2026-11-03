// 转公开动作的「平台规则」端口:只含纯判断,不含网络与数据库(网络仍走 PromoteDeps.meta)。
// 目的:把「发布目标合不合格 / 工单与流量记录的账号 id 对不对 / 视频归不归这个账号」这些
// 随平台而异的规则收进一处,共享流程(前置检查、上下文、收尾)只认端口,不再各自写死 Facebook。
// 目前只有 Facebook 一个实现;新平台 = 新增一个端口实现并登记到 portFor。

import type { PublishTarget } from '../../types'
import { facebookPromotePort } from './facebook-port'
import type { MetaReelView, PromoteOrder, TrafficRow } from './types'

export interface PortFailure {
  status: number
  error: string
}

export type IdsCheck =
  | { ok: true; videoId: string; accountId: string }
  | ({ ok: false } & PortFailure)

export interface PromotePlatformPort {
  readonly platform: PublishTarget['platform']
  /** 发布目标是否可转公开;不合格返回 422 原因(target 为 null 视为未配置)。 */
  checkTarget(target: PublishTarget | null): PortFailure | null
  /** 工单、流量记录、发布目标三方的视频 id 与账号 id 必须一致;按固定顺序检查,返回收窄后的 id。 */
  checkIds(order: PromoteOrder, row: TrafficRow, target: PublishTarget): IdsCheck
  /** 平台回读到的视频是否属于该账号(拿不准一律拒绝)。 */
  checkOwnership(view: MetaReelView, accountId: string): PortFailure | null
  /** 发布目标是否仍指向工单上记录的账号(补收尾时用)。 */
  matchesStoredAccount(target: PublishTarget, storedAccountId: string): boolean
  /** 转公开成功后追加写入工单 published_ref 的平台专属字段。 */
  publishedRefExtras(): Record<string, unknown>
}

const PORTS: readonly PromotePlatformPort[] = [facebookPromotePort]

/** 按发布目标的平台取端口;没有对应实现返回 null(调用方按「目标不可用」拒绝)。 */
export function portFor(platform: string | undefined): PromotePlatformPort | null {
  return PORTS.find((p) => p.platform === platform) ?? null
}
