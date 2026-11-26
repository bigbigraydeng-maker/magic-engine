/**
 * 读接口的出错写法（纯函数，不碰 Next）：返回的 `error` 都是给员工看的中文人话，不把英文原文或内部错误透出去。
 *  - 401 没登录 / 403 没权限（含「只限付费客户」的 402）→ 403 或 401；
 *  - 读权限时系统出错（500）→ 503「暂时读不到」；
 *  - 读数据出错 → 503（具体错误只写服务器日志）；找不到这封信 → 404。
 */

import { parseLetterKey } from './keys'

export interface HttpFailure {
  status: 401 | 403 | 404 | 503
  body: { error: string }
}

export const NOT_SIGNED_IN_TEXT = '请先登录。'
export const NO_ACCESS_TEXT = '你的账号没有查看这一页的权限。'
export const UNAVAILABLE_TEXT = '自动发信的情况暂时读不到，请稍后再试；如果一直这样，请告诉 Magic Lab 团队。'
export const LETTER_NOT_FOUND_TEXT = '没有找到这封信。'

export function failure(status: HttpFailure['status'], error: string): HttpFailure {
  return { status, body: { error } }
}

/** 鉴权没过 → 应该返回什么。 */
export function accessFailure(access: { status: number }): HttpFailure {
  if (access.status === 401) return failure(401, NOT_SIGNED_IN_TEXT)
  if (access.status === 402 || access.status === 403) return failure(403, NO_ACCESS_TEXT)
  return failure(503, UNAVAILABLE_TEXT)
}

export const unavailable = (): HttpFailure => failure(503, UNAVAILABLE_TEXT)
export const letterNotFound = (): HttpFailure => failure(404, LETTER_NOT_FOUND_TEXT)

/**
 * 路径里的信编号。Next 会把动态段解码一次；万一没解码（原样带着 %3A），再解一次试试。
 * 先试原样：解码过的编号里有「:」分隔位，没解码的没有，所以两种写法不会互相认错。认不出 → null。
 */
export function resolveLetterKey(raw: string): string | null {
  if (parseLetterKey(raw) !== null) return raw
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  return parseLetterKey(decoded) === null ? null : decoded
}
