/**
 * 行业专属页面的服务端闸（2026-08-03）。
 *
 * 藏掉导航按钮**不算修好** —— 网址还能直接敲进去。PM 2026-08-03 的原话是
 * 「不应该出现任何和地产有关的按钮和 page」，按钮和页面是两件事，两边都要挡。
 *
 * 跟 `industry-features.ts` 分文件：那个是纯判断逻辑，被 `'use client'` 的导航组件
 * 引用；这里要读数据库，混进去会把服务端代码打进浏览器包。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { hasIndustryFeature, type IndustryFeature } from './industry-features'

/**
 * 这个客户能不能开这个行业专属页面。
 *
 * 查不到客户 / 查询出错 → **false**（保守：宁可多挡一次，不可把地产页面漏给旅行社）。
 */
export async function clientHasIndustryFeature(
  clientId: string,
  feature: IndustryFeature,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('industry')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data) return false
  return hasIndustryFeature(data.industry as string | null, feature)
}

/** 挡下时给客户看的话 —— 说清楚是「不适用」，不是「你没权限」或者「坏了」。 */
export const INDUSTRY_FEATURE_NOTICE: Record<IndustryFeature, { title: string; body: string }> = {
  projects: {
    title: '这个功能不适用于你的业务',
    body: '「楼盘」是给房地产中介用的（Magic Engine 海外地产版）。如果这里应该出现，请在客户设置里把行业填成房地产。',
  },
  listings: {
    title: '这个功能不适用于你的业务',
    body: '「房子」是给房地产中介用的。如果这里应该出现，请在客户设置里把行业填成房地产。',
  },
  tailor_made: {
    title: '这个功能不适用于你的业务',
    body: '「行程单」是给旅游业务用的。如果这里应该出现，请在客户设置里把行业填成旅游。',
  },
}
