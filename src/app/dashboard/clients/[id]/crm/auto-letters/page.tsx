/**
 * 自动发信：看系统自动发给客人的信——内容、收件人、发送情况。只读，不发信。
 * 设计稿：Figma「自动发信 · 页面设计 v0.2」。
 *
 * 这一页只是个壳：渲染自包含的客户端组件 AutoSendBoard（props 只收 clientId），
 * 自己不读任何数据，也不做鉴权判断——跟 CRM 里「全部客人」「到期日历」「付款总览」这些页面一样，
 * 登录和客户范围由 /dashboard 的中间件管；真实数据来自读接口，鉴权在那些接口里做。
 * 以后要放进别的页面的标签里，原样搬 <AutoSendBoard /> 就行。
 */

import { AutoSendBoard } from '../_components/auto-send/AutoSendBoard'

export default function AutoLettersPage({ params }: { params: { id: string } }): JSX.Element {
  return <AutoSendBoard clientId={params.id} />
}
