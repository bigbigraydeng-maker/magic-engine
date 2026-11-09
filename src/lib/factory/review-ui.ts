// 审核弹窗的两个小帮手:来源网址预填 + 服务端英文报错翻成中文大白话。
// 只改展示,不碰服务端把关规则(review-apply.ts / content-review.ts 原样)。

import { isValidContentSourceRef } from '@/lib/social/content-review'

/** 工单链接(brief.copy.endcard.url)。只有产品深链才预填:copy-generator 常把它强制写成品牌首页,首页不是「片里事实的出处」。 */
export function defaultFactSourceRef(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('https://') || !isValidContentSourceRef(url)) return ''
  return new URL(url).pathname.replace(/\/+$/, '') === '' ? '' : url
}

/** labelOf:清单项 key → 中文名(弹窗里已有这张表,调用方传进来,避免再抄一份) */
export function reviewErrorZh(error: string, labelOf: (key: string) => string): string {
  const needSource = /^checklist (\w+) requires source_ref$/.exec(error)
  if (needSource) return `「${labelOf(needSource[1])}」这一项要填来源网址(https 开头),请填在这一项下面的输入框里。`
  if (error === 'all human checklist items must PASS') return '还有清单项没标「通过」,请每一项都标 PASS,再点「确定通过」。'
  if (error === 'checklist contains an invalid source_ref') return '来源网址格式不对,要填 https:// 开头的完整网址。'
  if (error === 'checklist source is not owned by this client') return '填的素材编号不属于这个客户,请改填官网产品页网址。'
  if (error.startsWith('automatic checklist')) return '自动媒体检测还没通过,系统不允许通过这条。请找开发处理,不是你填错了。'
  if (error === 'quality rejection requires a failed checklist item') return '打回要至少选一条理由。'
  if (error.startsWith('new_budget_usd')) return '预算要填大于 0、不超过 $50 的数字。'
  if (error.startsWith('only in_review') || error.includes('no longer in_review')) return '这条已经不在待审状态了,请刷新页面。'
  if (error.startsWith('checklist ')) return '清单提交有问题,请刷新页面重新勾一遍;还不行就把下面这句发给开发:' + error
  return `没通过成功:${error}(把这句话发给开发)`
}

export interface ReviewGateInput {
  autoReady: boolean                         // all automatic media checks PASS
  redlineHits: string[]                      // brand red-line phrases hit
  qualityFlags: Array<{ category: string }>  // yellow quality flags on this order
  factSourcePrefilled: boolean               // the fact-source URL prefill is non-empty
}

export interface ReviewGate {
  oneClick: boolean
  reasons: string[]
}

/** Decide whether the PM may approve in one click, or must review item by item. */
export function reviewGate(input: ReviewGateInput): ReviewGate {
  const reasons: string[] = []

  if (!input.autoReady) reasons.push('自动媒体检测未通过')
  if (input.redlineHits.length > 0) reasons.push('文案命中品牌红线,需逐项核对')

  for (const flag of input.qualityFlags) reasons.push(`品控提示未处理:${flag.category}`)

  if (!input.factSourcePrefilled) reasons.push('来源网址没有预填,需要手动填写')

  return { oneClick: reasons.length === 0, reasons }
}
