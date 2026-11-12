'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 列表页每次被显示时向服务器重新取一次数据。
 *
 * Next 14 的客户端路由缓存会把列表页留 30 秒，浏览器「后退」更是直接用缓存；
 * 顾问在编辑页保存/导出后点「返回」或后退，可能看到的是进编辑页之前的旧列表
 * （新建的单不在、标题还是「未命名行程」）。这里挂载时 refresh 一次兜底，
 * 并处理浏览器整页缓存（bfcache）恢复的情况。
 */
export default function RefreshOnShow() {
  const router = useRouter()

  useEffect(() => {
    router.refresh()
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh()
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [router])

  return null
}
