/**
 * 「全部客人」4 段跟进视图的**当场试跑**脚本 —— 对真实数据只读跑一遍装配管道。
 *
 * ## 为什么在仓库里而不是一次性脚本
 *
 * PM 2026-09-26 定的规矩：以后才会自动跑、或者会改变员工看到什么的东西，交付前
 * 必须当场手动触发一次完整链路，拿到真实输出才能说「做好了」，单元测试绿不算。
 * 分段视图每加一段、每改一次判据都要重跑这一遍，写成脚本比每次重新手搓可靠。
 *
 * ## 怎么跑
 *
 * ```bash
 * npx tsx --env-file=/path/to/.env.local scripts/probe-crm-priority-view.ts [clientId]
 * ```
 *
 * 密钥由 `node --env-file` 加载进 `process.env`，脚本自己不读、不打印任何密钥。
 * 默认客户是 CTS；传 clientId 可换客户。
 *
 * ## 它检查什么
 *
 * 1. **没人凭空消失** —— 4 段人数之和必须等于该客户联系人总数。这正是
 *    2026-08-02「33 位客人在页面上一个字都看不到」那次事故的判据
 *    （见 `lib/crm/worklist-groups.ts` 头注）。
 * 2. **分段只是分组、没有改判** —— 每段人数必须等于该段成员 segment 在旧的
 *    平铺口径下的人数之和。不等说明 `SECTION_OF_SEGMENT` 跟 `segmentContact`
 *    的认知对不上。
 * 3. 打印每段前 3 个抽样，人眼能看出落段合不合理。
 *
 * ## 全程只有 SELECT
 *
 * 三条 `select`，无写操作。安全地对生产跑。
 */
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { buildPriorityView } from '@/lib/crm/contact-list-view'
import { buildContactModel, type ContactRowLike, type StageMetaLike, type TouchpointRowLike } from '@/lib/crm/contact-model'
import { segmentContact, SEGMENT_META, type Segment } from '@/lib/crm/segments'
import { SECTION_OF_SEGMENT, type SectionKey } from '@/lib/crm/list-sections'
import { stageSuppressesWorklist, isMarketingAction } from '@/lib/crm/pipeline'

/** 默认客户 = CTS。这是脚本参数的缺省值，不是判据 —— 共享代码里没有客户事实。 */
const DEFAULT_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CLIENT_ID = process.argv[2] ?? DEFAULT_CLIENT_ID

interface ContactRow extends ContactRowLike {
  pinned_at: string | null
  first_seen_at: string
}
interface StageRow {
  stage_key: string
  label: string
  marketing_action: string
  is_terminal: boolean
}

async function main(): Promise<void> {
  const [contacts, touches, stageRows] = await Promise.all([
    fetchAll<ContactRow>((f, t) =>
      supabaseAdmin
        .from('contacts')
        .select('id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, stage, first_seen_at, pinned_at')
        .eq('client_id', CLIENT_ID)
        .order('id', { ascending: true })
        .range(f, t),
    ),
    fetchAll<TouchpointRowLike>((f, t) =>
      supabaseAdmin
        .from('contact_touchpoints')
        .select('contact_id, channel, direction, occurred_at, raw, metadata, source')
        .eq('client_id', CLIENT_ID)
        .order('occurred_at', { ascending: false })
        .range(f, t),
    ),
    fetchAll<StageRow>((f, t) =>
      supabaseAdmin
        .from('client_pipeline_stages')
        .select('stage_key, label, marketing_action, is_terminal')
        .eq('client_id', CLIENT_ID)
        .order('sort_order', { ascending: true })
        .range(f, t),
    ),
  ])
  console.log(`INPUT client=${CLIENT_ID} contacts=${contacts.length} touchpoints=${touches.length} stages=${stageRows.length}`)

  const stageMeta = new Map<string, StageMetaLike>()
  for (const s of stageRows) {
    stageMeta.set(s.stage_key, {
      label: s.label,
      suppressed: stageSuppressesWorklist(
        isMarketingAction(s.marketing_action) ? s.marketing_action : 'suppress',
        s.is_terminal,
      ),
    })
  }

  const now = new Date()

  // 旧口径：平铺列表逐人算分段 —— 也就是 #2045 之前「全部客人」页显示的那一列。
  const byContact = new Map<string, TouchpointRowLike[]>()
  for (const t of touches) {
    const l = byContact.get(t.contact_id) ?? []
    l.push(t)
    byContact.set(t.contact_id, l)
  }
  const segCount = new Map<Segment, number>()
  for (const c of contacts) {
    const seg = segmentContact(buildContactModel(c, byContact.get(c.id) ?? [], stageMeta), now)
    segCount.set(seg.segment, (segCount.get(seg.segment) ?? 0) + 1)
  }
  console.log('OLD flat segment distribution:')
  for (const s of Object.keys(SEGMENT_META) as Segment[]) {
    console.log(`  ${s.padEnd(20)} ${String(segCount.get(s) ?? 0).padStart(4)}`)
  }

  // 新口径：4 段视图（全部展开好数人头）。
  const { sections } = buildPriorityView(
    {
      contacts,
      touchpoints: touches,
      stageMeta,
      now,
      perPage: 5000,
      open: { waiting: true, acted: true, queued: true, off_list: true },
    },
    (row, ranked) => ({
      id: row.id,
      seg: ranked.seg.segment,
      pinned: ranked.pinnedAt !== null,
    }),
  )
  let sum = 0
  for (const s of sections) {
    sum += s.total
    console.log(`SECTION ${s.key.padEnd(9)} total=${String(s.total).padStart(4)}  ${s.title}`)
    const sample = (s.items ?? [])
      .slice(0, 3)
      .map((i) => `${i.id.slice(0, 8)}:${i.seg}${i.pinned ? '(置顶)' : ''}`)
    if (sample.length > 0) console.log(`         sample: ${sample.join('   ')}`)
  }
  console.log(`SUM sections=${sum} contacts=${contacts.length} match=${sum === contacts.length}`)

  // 交叉核对：每段人数应等于该段成员 segment 的旧口径人数之和。
  const expected: Record<SectionKey, number> = { waiting: 0, acted: 0, queued: 0, off_list: 0 }
  for (const [seg, n] of segCount) expected[SECTION_OF_SEGMENT[seg] ?? 'off_list'] += n
  const got: Record<SectionKey, number> = { waiting: 0, acted: 0, queued: 0, off_list: 0 }
  for (const s of sections) got[s.key] = s.total
  console.log('CROSSCHECK expected:', JSON.stringify(expected))
  console.log('CROSSCHECK got     :', JSON.stringify(got))
  console.log('CROSSCHECK identical=', JSON.stringify(expected) === JSON.stringify(got))
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error('PROBE FAILED:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
