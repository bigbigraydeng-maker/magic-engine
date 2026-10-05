// 审核弹窗的两个小帮手:来源网址预填 + 服务端英文报错翻成中文大白话。
// 只改展示,不碰服务端把关规则(review-apply.ts / content-review.ts 原样)。

import { isValidContentSourceRef } from '@/lib/social/content-review'

/** 工单自带的事实核对来源(brief.copy.endcard.url)。不是合法 https 网址就返回空,宁可留空让 PM 自己填。 */
export function defaultFactSourceRef(url: unknown): string {
  return typeof url === 'string' && url.startsWith('https://') && isValidContentSourceRef(url) ? url : ''
}

/** labelOf:清单项 key → 中文名(弹窗里已有这张表,调用方传进来,避免再抄一份) */
export function reviewErrorZh(error: string, labelOf: (key: string) => string): string {
  const needSource = /^checklist (\w+) requires source_ref$/.exec(error)
  if (needSource) return `「${labelOf(needSource[1])}」这一项要填来源网址(https 开头),请填在这一项下面的输入框里。`
  if (error === 'all human checklist items must PASS') return '还有清单项没标「通过」,请 9 项都标 PASS,再点「确定通过」。'
  if (error === 'checklist contains an invalid source_ref') return '来源网址格式不对,要填 https:// 开头的完整网址。'
  if (error === 'checklist source is not owned by this client') return '填的素材编号不属于这个客户,请改填官网产品页网址。'
  if (error.startsWith('automatic checklist')) return '自动媒体检测还没通过,系统不允许通过这条。请找开发处理,不是你填错了。'
  if (error.startsWith('only in_review') || error.includes('no longer in_review')) return '这条已经不在待审状态了,请刷新页面。'
  if (error.startsWith('checklist ')) return '清单提交有问题,请刷新页面重新勾一遍;还不行就把下面这句发给开发:' + error
  return `没通过成功:${error}(把这句话发给开发)`
}
