/**
 * 一次性回填：给**更早的** Meta 广告线索补上来源标签。
 *
 * ## 背景
 *
 * `meta-lead.ts` 原来只在「新建 Mailchimp 会员」那一次请求里顺带带标签。人已经
 * 在名单里时 Mailchimp 回 400 `Member Exists`，整次请求作废 —— 标签一个字都没
 * 写进去。CTS 的线索绝大多数是回头客，所以来源标签整整一个月一条都没打上
 * （见 `src/lib/mailchimp/tags.ts` 文件头）。
 *
 * PR #1448 修好了往后的：每小时同步碰到已在名单里的人会补打标签。但那个同步
 * **只回看 24 小时内的线索**，更早的永远轮不到。2026-09-07 实测：修复上线后
 * `fb_lead` 从 33 涨到 35（窗口内真缺的那 2 条补上了），仍有 13 个更早的线索
 * 在名单里却没有标签。这个脚本补的就是那一批。
 *
 * ## 只加不摘
 *
 * 只 `add`，绝不 `remove` —— 摘标签会直接改变一个人收不收得到邮件，而这个脚本
 * 面对的是历史数据，我们对这些人身上别的标签一无所知。
 *
 * 人不在名单里就跳过并计数，**绝不新建联系人**（同 `tags.ts` 那条护栏：给一个
 * 来路不明的地址建人再打标签，等于凭空把他塞进营销名单）。
 *
 * ## 幂等
 *
 * `applyMemberTags` 先查后改，标签已经对了就不发写请求。跑第二遍是安全的、
 * 而且便宜（只有查询，没有写入）。
 *
 * ## 执行回执（`--live` 强制要求）
 *
 * 真跑会改 Mailchimp —— 那是对外副作用，只打印到控制台不算数：终端一关，
 * 「哪一批来源记录、在哪次授权下、被改成了什么」就再也查不到了。所以 `--live`
 * **必须**带 `--receipt=<路径>`，逐条追加 JSONL：时间、客户、来源记录 id、
 * 邮箱的 Mailchimp subscriber hash（不落明文邮箱）、标签、provider 结果。
 *
 * **为什么不走 Inngest**（CLAUDE.md 铁律 3 允许写明例外）：这是操作者手动跑的
 * 一次性回填，不是跨步骤异步接力，没有事件接力和重试语义可言；套 Inngest 只会
 * 把「跑一条命令」变成「部署一个函数」。替代回执就是这个 JSONL 文件。
 * **恢复条件**：脚本幂等（`applyMemberTags` 先查后改，标签已对就不发写请求），
 * 中断后原样重跑即可，重跑会往同一个回执文件继续追加。
 *
 * ## ⚠️ 真跑（`--live`）之前必须先修这两条
 *
 * 目前只用来存档。Codex 复审指出两条**只在真跑时才咬人**的缺陷，还没修：
 *
 * 1. **可能漏掉同一个人的另一个邮箱**。挑目标邮箱靠的是
 *    `contact_identities.first_source = 'meta_lead_form'`，但 `first_source`
 *    只说明「这个身份第一次是从哪来的」。一个人先用邮箱 A 从别的渠道建档、
 *    后来 A 和 B 都交过 Meta 表单时，只有 B 会被算进来，A 被整个排除在兜底
 *    之外 —— 而 A 同样真的交过表单。正解是从**每一条来源事件**及其原始提交
 *    数据里取邮箱，而不是从聚合后的身份表反推。
 *
 * 2. **回执记的是联系人 id，不是来源记录 id**。同一个人交过多次表单时，几条
 *    回执长得一模一样，查不出「哪一次提交授权了哪一次修改」—— 跟本文件承诺的
 *    「来源记录 id」对不上。正解是把触点的 `id` / `source_ref` 一路带到每条
 *    回执里（现在的查询在中途就把它丢了）。
 *
 * 两条都不影响存档，但会让真跑的结果「少打一些人」且「回执追不到底」。
 *
 * 用法：
 *   npx tsx scripts/backfills/tag-historical-meta-leads.ts                 # 预演，零写入
 *   npx tsx scripts/backfills/tag-historical-meta-leads.ts --live --receipt=./backfill-YYYYMMDD.jsonl
 *   npx tsx scripts/backfills/tag-historical-meta-leads.ts --client-id=<uuid>
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const LIVE = process.argv.includes('--live')
/** 回执一旦写不进去就立起来，后面一律不再动 provider。 */
let receiptBroken = false
const receiptArg = process.argv.find((a) => a.startsWith('--receipt='))
const RECEIPT_PATH = receiptArg ? receiptArg.slice('--receipt='.length).trim() : ''
const clientIdArg = process.argv.find((a) => a.startsWith('--client-id='))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let ONLY_CLIENT_ID: string | null = null
if (clientIdArg) {
  const value = clientIdArg.slice('--client-id='.length).trim()
  if (!UUID_RE.test(value)) {
    // 空值或写错的 UUID 绝不能悄悄退化成「不过滤」—— 那会让一次本该只打
    // 一个客户的回填，误伤所有配了 Mailchimp 出口的客户。
    console.error(`--client-id 不是合法 UUID（收到 "${value}"），停手`)
    process.exit(1)
  }
  ONLY_CLIENT_ID = value
}

/** .in(...) 一次带太多 id 同样会顶到 PostgREST 上限，分批查。 */
const IN_BATCH_SIZE = 500

async function main() {
  // 动态引，等上面把 .env.local 灌进 process.env 之后再加载这些模块 ——
  // supabase 客户端在模块顶层就读 env。
  const { supabaseAdmin } = await import('../../src/lib/supabase')
  const { readAudienceId, readLeadSourceTag } = await import('../../src/lib/mailchimp/audience-config')
  const { applyMemberTags } = await import('../../src/lib/mailchimp/tags')
  const { evaluateDnc } = await import('../../src/lib/crm/meta-lead')
  const { fetchAll } = await import('../../src/lib/supabase-paginate')

  const apiKey = process.env.MAILCHIMP_API_KEY ?? ''
  if (!apiKey.trim()) {
    console.error('缺 MAILCHIMP_API_KEY，停手')
    process.exit(1)
  }

  // 对外副作用必须留下可追查的回执。没有落脚点就不许开跑 —— 事后补不回来。
  if (LIVE && !RECEIPT_PATH) {
    console.error('--live 必须同时给 --receipt=<路径>：改 Mailchimp 这种对外动作，')
    console.error('只打印到控制台等于没有回执，终端一关就再也查不到改过谁。')
    process.exit(1)
  }
  if (LIVE) {
    // 立刻验证这个路径真的写得进去 —— 跑到一半才发现目录不存在，前面改掉的
    // 那些人就没有任何记录了。
    try {
      appendFileSync(
        RECEIPT_PATH,
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'run_start',
          argv: process.argv.slice(2),
          clientScope: ONLY_CLIENT_ID ?? 'all',
        }) + '\n',
      )
    } catch (e) {
      console.error(`回执文件写不进去（${e instanceof Error ? e.message : String(e)}），停手`)
      process.exit(1)
    }
    console.log(`回执写到：${RECEIPT_PATH}`)
  }

  console.log(LIVE ? '模式：真的打标签\n' : '模式：预演（零写入）\n')

  let q = supabaseAdmin.from('clients').select('id, name')
  if (ONLY_CLIENT_ID) q = q.eq('id', ONLY_CLIENT_ID)
  const { data: clients, error: clientsErr } = await q
  if (clientsErr) {
    console.error('读客户列表失败:', clientsErr.message)
    process.exit(1)
  }

  const totals = { applied: 0, alreadyTagged: 0, notInAudience: 0, failed: 0, dncSkipped: 0 }

  for (const c of clients ?? []) {
    const audience = await readAudienceId(c.id)
    if (!audience.ok) {
      console.log(`⚠ ${c.name}: audience 配置读不出来（${audience.message}）—— 跳过，不猜`)
      totals.failed++
      continue
    }
    if (!audience.audienceId) continue // 这个客户没配出口，正常

    const tagRead = await readLeadSourceTag(c.id)
    if (!tagRead.ok) {
      console.log(`⚠ ${c.name}: 来源标签配置读不出来（${tagRead.message}）—— 跳过，不拿默认值糊`)
      totals.failed++
      continue
    }

    // 目标集合必须从「真的提交过 Meta Lead Form」这件事派生 —— 触点表
    // `contact_touchpoints.source = 'meta_lead_form'`，不能用联系人级的
    // `attr_platform`：官网表单带 Meta UTM 时也会把 attr_platform 写成
    // 'meta'（误伤），而 first-touch 是别的渠道、后来又交过 Meta 表单的人
    // 又会被漏掉（identity.ts 的 first-touch 规则不会覆盖 attr_platform）。
    //
    // 排序键必须是触点自己的唯一主键 `id`，不能用 `contact_id` —— 同一个人可以
    // 交过不止一次 Meta 表单，`contact_id` 不唯一，`fetchAll` 的分页边界一旦落
    // 在同一联系人的记录组中间就会重复或漏页（supabase-paginate.ts 的稳定排序
    // 契约）。
    let touches: { contact_id: string }[]
    try {
      touches = await fetchAll((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('contact_id')
          .eq('client_id', c.id)
          .eq('source', 'meta_lead_form')
          .order('id', { ascending: true })
          .range(from, to),
      )
    } catch (e) {
      console.log(`⚠ ${c.name}: 读触点失败（${e instanceof Error ? e.message : String(e)}）—— 跳过`)
      totals.failed++
      continue
    }
    const contactIds = [...new Set(touches.map((t) => t.contact_id))]
    if (!contactIds.length) continue

    // 目标邮箱优先取「这次 Meta 表单贡献的那条身份」
    // （`contact_identities.first_source = 'meta_lead_form'`）—— `resolveContact`
    // 命中已有联系人（多数是先靠电话建的人）时，只会把新邮箱追加进
    // `contact_identities`，不会回写 `contacts.primary_email`：电话联系人原本
    // 没有主邮箱时直接漏掉，已有旧主邮箱时则会给旧地址打标签。只有找不到这条
    // 身份（说明这次提交的邮箱其实早就是这个人另一渠道来的旧身份，
    // primary_email 当时就是照它设的）才退回 primary_email 兜底。
    //
    // 一个人可以用不同邮箱交过两次 Meta 表单，所以这里存**集合**不是单值：
    // 压成一个的话只有返回顺序里碰巧最后那个会被打上，另一个永远漏掉，而正常
    // 同步是按每次提交的邮箱各操作一次的。
    const emailsByContact = new Map<string, Set<string>>()
    let readFailed = false
    for (let i = 0; i < contactIds.length; i += IN_BATCH_SIZE) {
      const batch = contactIds.slice(i, i + IN_BATCH_SIZE)
      // 也得分页 —— 缩小 `.in(...)` 只压住了请求大小，压不住**返回行**的 1000
      // 行硬顶：一个人可以有不止一个 Meta 邮箱身份，500 个联系人凑够 1000 行
      // 完全可能，超出的部分会被 PostgREST 静默截掉，脚本还照样报成功。
      // 排序键用身份表自己的唯一主键 `id`（`contact_id` 不唯一，分页边界落在
      // 同一个人的记录组中间会重复或漏页）。
      let data: { contact_id: string; value: string }[]
      try {
        data = await fetchAll((from, to) =>
          supabaseAdmin
            .from('contact_identities')
            .select('contact_id, value')
            .eq('client_id', c.id)
            .eq('kind', 'email')
            .eq('first_source', 'meta_lead_form')
            .in('contact_id', batch)
            .order('id', { ascending: true })
            .range(from, to),
        )
      } catch (e) {
        console.log(
          `⚠ ${c.name}: 读联系人身份失败（${e instanceof Error ? e.message : String(e)}）—— 跳过`,
        )
        readFailed = true
        break
      }
      for (const row of data ?? []) {
        if (!row.value) continue
        const id = row.contact_id as string
        const set = emailsByContact.get(id) ?? new Set<string>()
        set.add(String(row.value).trim().toLowerCase())
        emailsByContact.set(id, set)
      }
    }
    if (readFailed) {
      totals.failed++
      continue
    }

    const fallbackIds = contactIds.filter((id) => !emailsByContact.has(id))
    for (let i = 0; i < fallbackIds.length; i += IN_BATCH_SIZE) {
      const batch = fallbackIds.slice(i, i + IN_BATCH_SIZE)
      const { data, error: contactsErr } = await supabaseAdmin
        .from('contacts')
        .select('id, primary_email')
        .in('id', batch)
        .not('primary_email', 'is', null)
      if (contactsErr) {
        console.log(`⚠ ${c.name}: 读客人失败（${contactsErr.message}）—— 跳过`)
        readFailed = true
        break
      }
      for (const row of data ?? []) {
        if (!row.primary_email) continue
        emailsByContact.set(row.id, new Set([String(row.primary_email).trim().toLowerCase()]))
      }
    }
    if (readFailed) {
      totals.failed++
      continue
    }

    // 摊平成「每个邮箱一条待办」—— 同一个人的两个邮箱是 Mailchimp 里两个会员，
    // 各自都要打上标签。
    const targets = [...emailsByContact.entries()].flatMap(([id, emails]) =>
      [...emails].filter(Boolean).map((email) => ({ id, email })),
    )
    if (!targets.length) continue

    console.log(
      `\n${c.name} —— ${emailsByContact.size} 个 Meta 表单客人 / ${targets.length} 个邮箱，标签 "${tagRead.tag}"`,
    )
    const cfg = { apiKey, audienceId: audience.audienceId }
    const per = { applied: 0, alreadyTagged: 0, notInAudience: 0, failed: 0, dncSkipped: 0 }

    for (const row of targets) {
      const email = row.email

      // 复用 meta-lead.ts 正常入口写 Mailchimp 前用的同一份统一 DNC 判据 ——
      // 拒联或查询失败（fail closed）一律不打标签，避免把已拒联的人重新
      // 拉进 `fb_lead` 分段，被后续按标签群发再次触达。
      const dnc = await evaluateDnc(row.id)
      if (dnc === 'blocked') {
        // 真的拒联 —— 这是**正确结果**，不是故障。不计入 failed。
        per.dncSkipped++
        console.log(`  ⛔ 跳过（拒联）: ${mask(email)}`)
        continue
      }
      if (dnc === 'unknown') {
        // 查询失败。跳过是对的（fail closed），但**必须计入 failed** —— 否则
        // 数据库抖一下导致整批人全被跳过，脚本还是退出码 0，跑的人会当成
        // 「补完了」。跟真拒联共用一个计数器 = 把故障伪装成正常。
        per.failed++
        console.log(`  ✗ DNC 查询失败，保守跳过: ${mask(email)}`)
        continue
      }

      // 回执已经写不进去了 → 下一刀不许再落。回执写在动作之后，所以「停手」
      // 只能靠动手之前的这道检查，不然就是句空话。
      if (receiptBroken) {
        per.failed++
        break
      }

      const r = await applyMemberTags(cfg, email, { add: [tagRead.tag] }, { dryRun: !LIVE })

      // 逐条落回执 —— 只在真跑时写。记的是 subscriber hash 不是明文邮箱：
      // 它既是 Mailchimp 里认人的那把钥匙（查得回去），又不是一份 PII 明文清单。
      const recorded = writeReceipt({
        ts: new Date().toISOString(),
        event: 'tag_write',
        clientId: c.id,
        clientName: c.name,
        sourceContactId: row.id,
        audienceId: audience.audienceId,
        subscriberHash: createHash('md5').update(email).digest('hex'),
        tag: tagRead.tag,
        result: r.status,
        reason: 'reason' in r ? r.reason : null,
      })
      if (!recorded) {
        // 这一刀已经落下去了但没记上 —— 计入失败，并且不再往下走。
        per.failed++
        break
      }

      if (r.status === 'applied') {
        per.applied++
        console.log(`  ${LIVE ? '打上' : '会打上'}: ${mask(email)}`)
      } else if (r.status === 'noop') {
        per.alreadyTagged++
      } else if (r.status === 'skipped') {
        per.notInAudience++
      } else {
        per.failed++
        // 不回显邮箱以外的 provider 细节；错误原因本身不含 PII。
        console.log(`  ✗ 失败: ${mask(email)} —— ${r.reason}`)
      }
    }

    console.log(
      `  小计：${LIVE ? '打上' : '会打上'} ${per.applied} · 本来就有 ${per.alreadyTagged} · ` +
        `不在名单里 ${per.notInAudience} · DNC 跳过 ${per.dncSkipped} · 失败 ${per.failed}`,
    )
    totals.applied += per.applied
    totals.alreadyTagged += per.alreadyTagged
    totals.notInAudience += per.notInAudience
    totals.dncSkipped += per.dncSkipped
    totals.failed += per.failed

    if (receiptBroken) {
      console.error('\n回执坏了，剩下的客户一个都不碰。修好落盘再重跑（脚本幂等）。')
      break
    }
  }

  console.log(
    `\n合计：${LIVE ? '打上' : '会打上'} ${totals.applied} · 本来就有 ${totals.alreadyTagged} · ` +
      `不在名单里 ${totals.notInAudience} · DNC 跳过 ${totals.dncSkipped} · 失败 ${totals.failed}`,
  )
  // 收尾标记也要看写没写进去。这一条恰好写不进去（磁盘刚好满、挂载刚好掉）时
  // 若忽略返回值，就会留下一份「没有完成标记、却被报成成功」的执行记录 ——
  // 事后没人分得清它是跑完了还是跑到一半断的。
  const endRecorded = writeReceipt({ ts: new Date().toISOString(), event: 'run_end', totals })

  if (!LIVE) console.log('\n这是预演，一个字都没写。确认没问题加 --live 再跑一遍。')
  else if (!endRecorded) console.error(`✗ 收尾回执没写进去，${RECEIPT_PATH} 缺完成标记`)
  else console.log(`回执已写到：${RECEIPT_PATH}`)
  if (totals.failed > 0 || !endRecorded) process.exit(1)
}

/**
 * 追加一条回执。预演时不写（预演没有副作用，没什么好追查的）。
 *
 * **写不进去就立刻停掉后面所有 provider 写入。** 上一版这里只打印然后继续 ——
 * 那是错的：磁盘写满 / 挂载掉线 / 权限被改之后，后面每一次改 Mailchimp 都在
 * 没有任何记录的情况下发生，最后还可能以退出码 0 收场，跑的人以为回执齐全。
 * 「有副作用但没有回执」比「少改几个人」严重得多，所以这里选择停手。
 *
 * 返回 false = 已经记不下来了，调用方必须停。
 */
function writeReceipt(entry: Record<string, unknown>): boolean {
  if (!LIVE || !RECEIPT_PATH) return true
  if (receiptBroken) return false
  try {
    appendFileSync(RECEIPT_PATH, JSON.stringify(entry) + '\n')
    return true
  } catch (e) {
    receiptBroken = true
    console.error(`✗ 回执写入失败（${e instanceof Error ? e.message : String(e)}）`)
    console.error('  从这里开始不再改任何东西 —— 改了却记不下来，等于查不回去。')
    return false
  }
}

/** 日志里不回显完整邮箱。 */
function mask(email: string): string {
  return email.replace(/^(.).*(@.*)$/, (_m, a, b) => `${a}***${b}`)
}

main().catch((e) => {
  console.error('脚本挂了:', e)
  process.exit(1)
})
