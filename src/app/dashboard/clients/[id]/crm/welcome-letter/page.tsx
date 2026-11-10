/**
 * 欢迎信自动发送：PM 在这里看提案、看信、看彩排对照，点「授权」或「撤销」。
 *
 * 这一页只是个壳：渲染自包含的客户端组件 WelcomeLetterPanel（props 只收 clientId），自己不读数据、不做鉴权——
 * 跟 CRM 里其它页面一样，登录和客户范围由 /dashboard 的中间件管；数据和「只有全局管理员能看能点」在
 * /api/clients/[id]/triggered-send/* 这四个接口里做。这一页本身不发信。
 */
import { WelcomeLetterPanel } from '../_components/welcome-letter/WelcomeLetterPanel'

export default function WelcomeLetterPage({ params }: { params: { id: string } }): JSX.Element {
  return <WelcomeLetterPanel clientId={params.id} />
}
