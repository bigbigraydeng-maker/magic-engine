// 转公开动作的 Meta 端口(生产实现)。薄封装现有 facebook-reel-adapter,不另起一套 Graph 调用约定。
// 不含任何令牌输出:错误文本只带状态码与 Meta 的 message,不带请求网址。

import type { PublishTarget, PublishedRef } from '../../types'
import { GRAPH, facebookReelAdapter, promoteReelToPublished, resolveToken } from '../facebook-reel-adapter'
import { asRecord } from './guards'
import { PromoteMetaError, type MetaReelView, type PromoteMeta } from './types'

/** Graph 对「对象不存在 / 已删除」返回 code 100(subcode 33)或 404。 */
function isMissing(status: number, body: Record<string, unknown>): boolean {
  const err = asRecord(body['error'])
  return status === 404 || (err['code'] === 100 && err['error_subcode'] === 33)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

async function readReel(target: PublishTarget, videoId: string): Promise<MetaReelView> {
  const { accessToken } = await resolveToken(target)
  const fields = 'published,from,description,updated_time,permalink_url'
  const res = await fetch(`${GRAPH}/${videoId}?fields=${fields}&access_token=${accessToken}`)
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const message = str(asRecord(json['error'])['message']) ?? 'unknown'
    throw new PromoteMetaError(isMissing(res.status, json) ? 'video_missing' : 'other', `FB 读视频失败 ${res.status}: ${message}`)
  }
  return {
    published: json['published'] === true,
    fromId: str(asRecord(json['from'])['id']),
    description: typeof json['description'] === 'string' ? json['description'] : '',
    updatedTime: str(json['updated_time']),
    permalink: str(json['permalink_url']),
  }
}

export function createPromoteMeta(): PromoteMeta {
  return {
    readReel,
    promote: (target: PublishTarget, videoId: string): Promise<PublishedRef> => promoteReelToPublished({ target, videoId }),
    async ensureFirstComment(args) {
      if (!facebookReelAdapter.ensureFirstComment) throw new PromoteMetaError('other', '首评能力不可用')
      return facebookReelAdapter.ensureFirstComment(args)
    },
  }
}
