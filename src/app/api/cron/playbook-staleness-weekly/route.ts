import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { validateFindingsPayload } from '@/lib/pm-todo/playbook-staleness-validation'

/**
 * POST /api/cron/playbook-staleness-weekly
 *
 * 每周一次，由仓库外的 Claude scheduled task（`playbook-staleness-weekly`，
 * 见 `~/.claude/scheduled-tasks/playbook-staleness-weekly/SKILL.md`）调用——
 * 那个任务读 7 本经验手册 + grep 这个仓库，把"疑似过期"的引用整理成一份
 * findings 数组 POST 过来。这个接口只做两件事：校验（见 `playbook-staleness-
 * validation.ts`——校验逻辑不放这个文件里，App Router 的 route.ts 只允许导出
 * HTTP handler，导出别的符号会被 `.next/types` 判成非法导出）+ 全量替换落库
 * （`playbook_staleness_findings`）。核对逻辑本身不在这里，在 scheduled task 里。
 *
 * 全量替换：写之前先清空整张表，再插入这次收到的 findings —— 一条引用这周
 * 没有再被点名，就自然从表里消失，不需要任何"标记为已处理"的状态机
 * （设计审 2026-09-24 定论，见 playbook-staleness-items.ts 头注）。
 *
 * Auth: Bearer ${CRON_SECRET}——跟其它 /api/cron/* 路由用同一把密钥，
 * 不为这个接口另开新密钥。
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'body 不是合法 JSON' }, { status: 400 })
  }

  const validation = validateFindingsPayload(body)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const cronRun = await startCronRun('playbook-staleness-weekly')
  try {
    // 全量替换：先清空整张表——delete 要求至少一个过滤条件，用 id not null 匹配全表。
    const { error: deleteError } = await supabaseAdmin
      .from('playbook_staleness_findings')
      .delete()
      .not('id', 'is', null)
    if (deleteError) throw new Error(`清空旧数据失败: ${deleteError.message}`)

    if (validation.findings.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('playbook_staleness_findings')
        .upsert(
          validation.findings.map((f) => ({ ...f, detected_at: new Date().toISOString() })),
          { onConflict: 'playbook_path,reference_text' },
        )
      if (insertError) throw new Error(`写入新数据失败: ${insertError.message}`)
    }

    await cronRun.finish({
      processed: validation.findings.length,
      completed: validation.findings.length,
      summary: { count: validation.findings.length },
    })
    return NextResponse.json({ ok: true, count: validation.findings.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
