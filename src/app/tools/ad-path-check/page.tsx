import type { Metadata } from 'next'
import Checker from './Checker'

export const metadata: Metadata = {
  title: '广告到询盘体检',
  description: '输入你的网站，免费查看联系入口、广告路径和追踪基础。无需注册，不用安装。',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function AdPathCheckPage() {
  return <Checker enabled={process.env.AD_PATH_CHECKER_ENABLED === 'true'} />
}
