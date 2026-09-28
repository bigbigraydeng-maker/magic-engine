/**
 * 当场试跑：阶段变更那一行，员工**现在**看到什么、**改完**看到什么。
 *
 * ## 为什么要这一遍
 *
 * PM 2026-09-27 的方向是「让大模型根据互动痕迹判断并给建议」。AI 已经判了，
 * 而且每次都写了理由和客人原话 —— 但两个时间线渲染器没有一个把它完整显示出来，
 * 其中一个还把 `ai:conversation-read` 这串内部字符串原样丢给销售看。
 *
 * 这个脚本拿**生产真数据**跑一遍翻译，把「改前 / 改后」两行并排打出来，
 * 好让人眼确认：员工看到的是人话，而且看得见凭据。
 *
 * 单元测试只能证明「给定这串字符串，输出那句话」；它证明不了
 * **生产库里真实出现的取值有没有漏掉一种**。所以这一遍必须对生产跑。
 *
 * ## 怎么跑
 *
 * ```bash
 * npx tsx --env-file=/path/to/.env.local scripts/probe-crm-stage-actor-label.ts
 * ```
 *
 * 密钥由 `node --env-file` 加载，脚本自己不读、不打印任何密钥。全程只有 SELECT。
 */
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { describeStageActor, stageChangeWasAutomated, stageReasonForDisplay } from '@/lib/crm/actors'

interface Ev {
  changed_by: string | null
  note: string | null
  to_stage: string | null
  created_at: string
}

/** 改之前「今天要联系」页那一行是怎么算的（照抄旧的 changedByLabel）。 */
function oldLabel(raw: string | null): string {
  if (!raw) return ''
  if (raw === 'system:qualified-buyer') return '系统自动'
  return raw.split('@')[0]
}

const failed: string[] = []

async function main(): Promise<void> {
  const rows = await fetchAll<Ev>((from, to) =>
    supabaseAdmin
      .from('contact_stage_events')
      .select('changed_by, note, to_stage, created_at')
      .order('created_at', { ascending: false })
      .range(from, to),
  )
  console.log(`\n【阶段变更那一行 · 当场试跑】生产库共 ${rows.length} 条\n`)

  const byActor = new Map<string, Ev[]>()
  for (const r of rows) {
    const k = r.changed_by ?? '(空)'
    byActor.set(k, [...(byActor.get(k) ?? []), r])
  }

  console.log('每一种「谁改的」翻译成什么：\n')
  for (const [actor, list] of [...byActor].sort((a, b) => b[1].length - a[1].length)) {
    const now = describeStageActor(actor === '(空)' ? null : actor)
    const before = oldLabel(actor === '(空)' ? null : actor)
    const withNote = list.filter((r) => r.note && r.note.trim()).length
    console.log(`  ${String(list.length).padStart(4)} 条  原始值 ${actor}`)
    console.log(`          改前员工看到：「${before || '（什么都没显示）'}」`)
    console.log(`          改后员工看到：「${now}」`)
    console.log(`          这一类里 ${withNote}/${list.length} 条带理由；是机器判的：${stageChangeWasAutomated(actor === '(空)' ? null : actor) ? '是' : '否'}`)

    // 判据 1：改后绝不能把内部字符串露出去
    if (/^(ai|system):/i.test(actor) && now.includes(':')) {
      failed.push(`${actor} 改后仍含冒号：${now}`)
    }
    // 判据 2：机器身份不能被说成「XXX 改的」（像人名）
    if (stageChangeWasAutomated(actor === '(空)' ? null : actor) && now.includes('改的')) {
      failed.push(`${actor} 是机器，却被说成「${now}」`)
    }
    console.log()
  }

  console.log('随手抽三条，看员工完整会看到什么一行：\n')
  for (const r of rows.slice(0, 3)) {
    const who = describeStageActor(r.changed_by)
    const reason = stageReasonForDisplay(r.note)
    const why = reason ? ` · ${reason}` : ''
    console.log(`  🔀 还没标 → ${r.to_stage} · ${who}${why}`)
    console.log()
  }

  // 判据 3b：剥开头不能顺手吃掉客人原话 —— 凭据是整件事的重点
  const withQuote = rows.filter((r) => (r.note ?? '').includes('原话'))
  const lostQuote = withQuote.filter((r) => !(stageReasonForDisplay(r.note) ?? '').includes('原话'))
  console.log(`带客人原话的 ${withQuote.length} 条，剥开头之后原话还在的 ${withQuote.length - lostQuote.length} 条`)
  if (lostQuote.length > 0) failed.push(`剥开头吃掉了 ${lostQuote.length} 条的客人原话`)

  // 判据 4：剥完不能还留着那个开头（说明常量漂移了）
  const stillDoubled = rows.filter((r) => (stageReasonForDisplay(r.note) ?? '').startsWith('读往来记录判的'))
  if (stillDoubled.length > 0) failed.push(`${stillDoubled.length} 条剥完还留着开头 —— 前缀常量跟写入侧漂移了`)

  // 判据 3：AI 判的那一大类必须几乎都带理由，否则「凭这句」是空的
  const ai = byActor.get('ai:conversation-read') ?? []
  if (ai.length > 0) {
    const withNote = ai.filter((r) => r.note && r.note.trim()).length
    const pct = (withNote / ai.length) * 100
    console.log(`AI 判的 ${ai.length} 条里 ${withNote} 条带理由（${pct.toFixed(0)}%）`)
    if (pct < 95) failed.push(`AI 判断带理由的只有 ${pct.toFixed(0)}%，「凭这句」会经常空着`)
  }

  console.log(
    failed.length === 0
      ? '\n【结论】全部通过：每一种「谁改的」都翻成了人话，没有内部字符串漏给员工，机器不会被说成人。\n'
      : `\n【结论】${failed.length} 项没过：\n  - ${failed.join('\n  - ')}\n`,
  )
  if (failed.length > 0) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error('试跑本身挂了：', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
