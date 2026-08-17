/**
 * ME2 Product Map —— PO 控制台(WP: ME2 Product Map v1,PR 3/3)。
 *
 * 只读页面:零写入按钮、零 GitHub 写回。数据来自
 * 代码仓库里的组件登记册(PR1)+ GitHub 同步快照(PR2)。
 *
 * 四态判定与塑形都在 lib 里(可测);这里只负责载入 + 渲染。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { SupabaseSyncStore } from '@/lib/product-map-sync'
import { loadProductMapConsole } from '@/lib/product-map-sync/console-loader'
import ProductMapClient from './_components/ProductMapClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'ME2 产品地图 · Magic Engine',
}

export default async function ProductMapPage() {
  const presentation = await loadProductMapConsole(new SupabaseSyncStore(supabaseAdmin))
  return <ProductMapClient data={presentation} />
}
