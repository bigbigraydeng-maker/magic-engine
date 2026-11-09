/** 上线签字 —— 路由共用：错误翻译、服务依赖。 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { LaunchSignoffError } from './errors'
import { currentCommitFromEnv, type ServiceDeps } from './service'

export function depsFromEnv(): ServiceDeps {
  return { db: supabaseAdmin, commit: currentCommitFromEnv() }
}

/** 把业务错误翻译成人话响应；其它错误一律“读写失败”，不泄露细节、不伪装成成功。 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof LaunchSignoffError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
  }
  console.error('[launch-signoff] unexpected failure', err instanceof Error ? err.message : 'unknown')
  return NextResponse.json({ error: '读写失败，请稍后再试（没有改动任何记录）', code: 'internal' }, { status: 500 })
}

