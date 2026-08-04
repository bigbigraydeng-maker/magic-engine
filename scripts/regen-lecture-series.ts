/**
 * 系列课脚本重生成(一次性/可复用) — 用升级后的讲课式生成器把整套课的脚本重写一遍。
 * 场景：PM 审后觉得整套「太水」返工(2026-08-01 大瑞 AI 海外获客 6 讲)。
 * 旧稿自动备份进 snapshot.lecture_prev，可在单讲工作台回滚比对。
 *
 * Usage:
 *   REGEN_CLIENT_ID=<uuid> REGEN_SOURCE='系列课·xxx' npx tsx --env-file=.env.local scripts/regen-lecture-series.ts
 * 只跑某几讲(逗号分隔第几讲):
 *   REGEN_LESSONS=2,5 REGEN_CLIENT_ID=... REGEN_SOURCE=... npx tsx --env-file=.env.local scripts/regen-lecture-series.ts
 */

import { supabaseAdmin } from '@/lib/supabase'
import { planLectureScript } from '@/lib/factory/lecture-script'
import { saveLectureScript } from '@/lib/factory/lecture-post'

const clientId = process.env.REGEN_CLIENT_ID
const source = process.env.REGEN_SOURCE
const onlyLessons = (process.env.REGEN_LESSONS ?? '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n))

async function main(): Promise<void> {
  if (!clientId || !source) throw new Error('需要 REGEN_CLIENT_ID 和 REGEN_SOURCE')

  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .select('id, title, status, generation_context_snapshot')
    .eq('client_id', clientId)
    .eq('source', source)
    .order('created_at', { ascending: true })
  if (error) throw error
  if (!data?.length) throw new Error(`没找到 source=${source} 的内容`)

  for (const post of data) {
    const snap = post.generation_context_snapshot as { lesson_no?: number } | null
    const lessonNo = snap?.lesson_no ?? 0
    if (onlyLessons.length > 0 && !onlyLessons.includes(lessonNo)) continue
    if (post.status === 'published' || post.status === 'scheduled') {
      console.log(`跳过 第${lessonNo}讲(${post.status})`)
      continue
    }

    const topic = post.title.replace(/^【系列课·第\d+讲】/, '')
    console.log(`重写 第${lessonNo}讲：${topic}`)
    const lecture = await planLectureScript({
      clientId,
      topic: `${topic}\n(整套课的第${lessonNo}讲。上一版被打回，原因：太多口号空话。这一版必须全是可照做的具体步骤和真实工具名。)`,
    })
    await saveLectureScript({ clientId, postId: post.id, lecture, backupPrev: true })
    console.log(`  ✅ 已回写(${lecture.sections.length} 个要点，旧稿在 lecture_prev)`)
  }
  console.log('完成')
}

main().catch((e) => {
  console.error('失败：', e instanceof Error ? e.message : e)
  process.exit(1)
})
