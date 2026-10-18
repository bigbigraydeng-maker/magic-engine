// 转公开动作的生产依赖装配(路由用)。测试与试跑用 action.ts 的 PromoteDeps 注入替身,不走这里。

import { randomBytes, randomUUID } from 'node:crypto'
import { resolveTarget, scanPublishCaption } from '../publish-worker'
import { createPromoteMeta } from './meta-port'
import { createSupabasePromoteStore } from './store'
import type { PromoteDeps } from './types'

export function createProductionPromoteDeps(): PromoteDeps {
  return {
    store: createSupabasePromoteStore(),
    meta: createPromoteMeta(),
    resolveTarget,
    scanRedline: (clientId, masterBriefId, text) => scanPublishCaption(clientId, masterBriefId, text),
    now: () => new Date(),
    uuid: () => randomUUID(),
    randomToken: () => randomBytes(24).toString('base64url'),
    alert: (message) => console.error(`[reel-promote] ${message}`),
  }
}
