/**
 * #1397 PR1 migration 的静态守卫。
 *
 * 🔴 **这些断言证明的是「迁移文件写了什么」，不是「数据库真的会那样做」。**
 *    触发器拦不拦得住 service_role、CHECK 会不会在 NULL 上放行、匿名 key 读不读得到 ——
 *    只能在 apply 之后用真库验，那一步是单独授权的运维动作，不在本 PR 里。
 *    apply 后的自验清单写在迁移文件末尾。
 *    把文本扫描说成「已验证」，等于给自己发一张假绿灯。
 *
 * 扫描前先去掉 SQL 注释 —— 否则**解释规则的注释本身**会被当成罪证
 * （仓库的架构测试早就踩过这个坑）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations')
// 2026-09-07：原本用 20260905000001，与 social_post_measurement_receipts 撞号。
// social 那条已在 main（更早落地），本迁移休眠未 apply、无下游依赖，故本迁移让号后移。
const MIGRATION_VERSION = '20260905000002'
const MIGRATION_FILE = `${MIGRATION_VERSION}_conversion_writeback_v1.sql`

const RAW = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8')

function stripSqlComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

const SQL = stripSqlComments(RAW)

/**
 * 取一段 SQL 区间。
 * 🔴 定位标记找不到时**直接抛错**，不返回空串 —— 在空文本上做 `.not.toContain(...)`
 *    是恒真的，那是一条永远绿、什么都不保证的测试。
 */
function region(startMarker: string, endMarker?: string): string {
  const start = SQL.indexOf(startMarker)
  if (start === -1) throw new Error(`区间起点不存在（切片会变成 fail-open）: ${startMarker}`)
  if (endMarker === undefined) return SQL.slice(start)
  const end = SQL.indexOf(endMarker, start)
  if (end === -1) throw new Error(`区间终点不存在（切片会变成 fail-open）: ${endMarker}`)
  return SQL.slice(start, end)
}

const TABLES = ['me_sale_outcomes', 'me_conversion_writebacks', 'me_conversion_audit'] as const

describe('#1397 migration · 版本号与边界', () => {
  it('版本号在整个 migrations 目录里唯一', () => {
    const sameVersion = readdirSync(MIGRATIONS_DIR).filter(
      (f) => f.endsWith('.sql') && f.slice(0, 14) === MIGRATION_VERSION,
    )
    expect(
      sameVersion,
      '两个 migration 用同一个版本号时，各自分支上都看不出来，合并后账本会出现重复 version。',
    ).toEqual([MIGRATION_FILE])
  })

  it('三张表都建了', () => {
    for (const t of TABLES) {
      expect(SQL).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`)
    }
  })

  it('没有顺手建 Phase B/C 才该有的东西', () => {
    // 自定义受众、EMQ 快照、lead 判定规则都是后续阶段的未决项，
    // 在 PR1 里「顺手建一张」等于替后面的设计拍了板。
    const forbidden = [
      'me_custom_audiences',
      'me_audience_members',
      'me_emq_snapshots',
      'me_lead_rules',
      'flywheel_outcomes',
      // 2026-09-05 PM 审"有没有过度开发"后砍掉：同步发送用不上熔断，
      // opt-out 用既有的 contacts.do_not_contact。真需要时再加，别提前建。
      'me_conversion_breakers',
      'me_pii_suppression',
    ]
    const built = forbidden.filter((n) => new RegExp(`CREATE TABLE[^;]*\\b${n}\\b`).test(SQL))
    expect(built, `不属于 PR1 的表：\n${built.join('\n')}`).toEqual([])
  })
})

describe('#1397 migration · RLS 与授权面', () => {
  it.each(TABLES)('public.%s 开了行级安全', (table) => {
    expect(SQL).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
  })

  it('每一条策略都写了 TO service_role（漏掉 = 对匿名访客敞开读写）', () => {
    const policies = Array.from(SQL.matchAll(/CREATE POLICY[\s\S]*?;/g)).map((m) => m[0])
    expect(policies.length, '三张表各一条策略').toBe(3)
    const missing = policies.filter((p) => !/FOR ALL TO service_role/.test(p))
    expect(
      missing,
      '2026-08-03 实测：CREATE POLICY ... USING (true) 漏写 TO service_role 会默认成 TO PUBLIC，\n' +
        '当时泄露了 118 条策略覆盖的数据。这几张表里全是客户真名真邮真电话。\n' +
        missing.join('\n'),
    ).toEqual([])
  })

  it('没有 anon / authenticated / PUBLIC 策略', () => {
    const leaks = ['TO anon', 'TO authenticated', 'TO PUBLIC', 'TO public'].filter((r) =>
      SQL.includes(r),
    )
    expect(leaks, '本 PR 没有任何 authenticated 调用方，不许凭空授予。\n' + leaks.join('\n')).toEqual(
      [],
    )
  })

  it('没有 auth.uid() / client_team / workspace_id 这几种被明令禁止的判据', () => {
    const forbidden = ['auth.uid()', 'auth.jwt()', 'client_team', 'workspace_id'].filter((f) =>
      SQL.includes(f),
    )
    expect(forbidden, 'CLAUDE.md 铁律 7 明令禁止。\n' + forbidden.join('\n')).toEqual([])
  })

  it('没有 SECURITY DEFINER（默认把 EXECUTE 授予 anon，而 anon key 就在浏览器 bundle 里）', () => {
    expect(SQL.includes('SECURITY DEFINER')).toBe(false)
  })

  it('触发器函数钉死了 search_path', () => {
    const fns = Array.from(SQL.matchAll(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$\$/g)).map((m) => m[0])
    expect(fns.length).toBeGreaterThan(0)
    const unpinned = fns.filter((f) => !/SET search_path\s*=/.test(f))
    expect(
      unpinned,
      '调用者若改过 search_path，函数里无 schema 限定的名字解析目标就会变。\n' + unpinned.join('\n'),
    ).toEqual([])
  })
})

describe('#1397 migration · 审计只增不改（靠触发器，不靠 policy）', () => {
  it('挂了 BEFORE UPDATE OR DELETE 触发器', () => {
    expect(SQL).toMatch(
      /CREATE TRIGGER me_conversion_audit_append_only_trigger\s+BEFORE UPDATE OR DELETE ON public\.me_conversion_audit/,
    )
  })

  it('也挡住了 TRUNCATE（行级触发器对 TRUNCATE 不触发）', () => {
    expect(SQL).toMatch(
      /CREATE TRIGGER me_conversion_audit_no_truncate\s+BEFORE TRUNCATE ON public\.me_conversion_audit/,
    )
  })

  it('触发器函数无条件抛错，没有任何放行分支', () => {
    const fn = region(
      'FUNCTION public.me_conversion_audit_append_only()',
      'DROP TRIGGER IF EXISTS me_conversion_audit_append_only_trigger',
    )
    expect(fn).toContain('RAISE EXCEPTION')
    expect(
      /RETURN (NEW|OLD)/.test(fn),
      '有 RETURN 放行路径就意味着存在一条能改审计日志的缝 —— ' +
        '而审计日志的全部价值就在于它改不了。',
    ).toBe(false)
  })
})

describe('#1397 migration · 防重复发送的硬闸', () => {
  it('(destination, event_id) 唯一 —— 数据库层最后一道防线', () => {
    expect(SQL).toContain('CONSTRAINT me_conversion_writebacks_once UNIQUE (destination, event_id)')
  })

  it('status 枚举里有 sending 与 in_doubt（缺任一则双发防护不成立）', () => {
    const block = region(
      'CREATE TABLE IF NOT EXISTS public.me_conversion_writebacks',
      'CREATE INDEX IF NOT EXISTS idx_me_conversion_writebacks_outcome',
    )
    // sending：发送中的中间态，CAS 的落点
    // in_doubt：不知道 Meta 收没收 —— 自动路径永不重发，人工去核对
    for (const s of ['sending', 'in_doubt', 'expired_no_send', 'confirmed', 'failed_permanent']) {
      expect(block, `status 枚举缺 '${s}'`).toContain(`'${s}'`)
    }
  })

  it('有 post_started_at 列（发 HTTP 前的 CAS 标记）', () => {
    const block = region(
      'CREATE TABLE IF NOT EXISTS public.me_conversion_writebacks',
      'CREATE INDEX IF NOT EXISTS idx_me_conversion_writebacks_outcome',
    )
    expect(
      block,
      '挡"同一条被发两次"：按钮连点、请求重试、进程崩了重来。\n' +
        'DB 写必须在 HTTP 之前 —— 反过来就是先发了再记账，中间崩掉会重发。',
    ).toContain('post_started_at')
  })

  it('有 last_attempt_at 列，且索引落在它上面', () => {
    // 卡在 sending 的行靠它判断"卡了多久"，据此转 in_doubt 交人工核对。
    // 不写这列，卡住的行没人认得出来，连客人要求删除都做不了。
    expect(SQL).toContain('last_attempt_at')
    expect(SQL).toMatch(
      /idx_me_conversion_writebacks_sending[\s\S]*?\(last_attempt_at\)[\s\S]*?WHERE status = 'sending'/,
    )
  })

  it('🔴 同一笔外部记录只能进来一次（挡另一个方向的重复）', () => {
    // 发送侧三道闸防的是「同一行被发两次」。挡不住外部同步跑两遍建出
    // 两行不同 id 指向同一笔交易 —— 那是两个身份，三道闸一道都不认识，
    // 广告平台照样记两笔，而且撤不回。PM 2026-09-05 定了一个月内上 HubSpot，
    // 这条从"以后可能有用"变成"马上就要用"。
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_me_sale_outcomes_source[\s\S]*?\(client_id, source_kind, source_ref\)[\s\S]*?WHERE source_ref IS NOT NULL/,
    )
  })

  it('外部 CRM 是一种合法来源（HubSpot 同步的落点）', () => {
    expect(SQL).toContain("'crm_hubspot'")
  })

  it('幂等键不是由可变字段哈希出来的', () => {
    // 用 SHA256(client||order_ref||event_time) 当幂等键的话，
    // 改一次付款时间哈希就变，同一笔会被 Meta 记两次。
    const block = region(
      'CREATE TABLE IF NOT EXISTS public.me_conversion_writebacks',
      'CREATE INDEX IF NOT EXISTS idx_me_conversion_writebacks_outcome',
    )
    expect(/GENERATED ALWAYS AS[^,]*event_id/.test(block)).toBe(false)
    expect(block).toContain('event_id         text        NOT NULL')
  })
})

describe('#1397 migration · 事实表的约束（每条都对应一个真实的错误场景）', () => {
  const block = region(
    'CREATE TABLE IF NOT EXISTS public.me_sale_outcomes',
    'CREATE INDEX IF NOT EXISTS idx_me_sale_outcomes_pending',
  )

  it('purchase / balance 必须带金额与币种，lead 不必', () => {
    expect(block).toContain('CONSTRAINT me_sale_outcomes_amount_required')
    const c = region('CONSTRAINT me_sale_outcomes_amount_required', 'CONSTRAINT me_sale_outcomes_amount_positive')
    expect(
      c.includes("outcome_kind = 'lead'") && c.includes('amount_minor IS NOT NULL') && c.includes('currency IS NOT NULL'),
      '少了金额的 purchase 发给 Meta = 告诉它"有人买了但不知道多少钱"，价值优化直接失效。',
    ).toBe(true)
  })

  it('币种必须是大写三字母 ISO 4217', () => {
    const c = region('CONSTRAINT me_sale_outcomes_currency_iso', 'CONSTRAINT me_sale_outcomes_amount_required')
    expect(c).toContain('currency = upper(currency)')
    expect(c).toContain('length(currency) = 3')
  })

  it('金额必须为正（退款不走这张表）', () => {
    expect(block).toContain('CONSTRAINT me_sale_outcomes_amount_positive')
  })

  it('拒绝回写必须给理由', () => {
    const c = region('CONSTRAINT me_sale_outcomes_reject_reason_required', 'CONSTRAINT me_sale_outcomes_redacted_is_empty')
    expect(c).toContain("review_status <> 'rejected'")
    expect(c).toContain('reject_reason IS NOT NULL')
  })

  it('脱敏后 PII 四列必须真的清空（只写时间戳 = 假脱敏）', () => {
    const c = region('CONSTRAINT me_sale_outcomes_redacted_is_empty', 'CONSTRAINT me_sale_outcomes_needs_match_key')
    const missing = ['customer_email', 'customer_phone', 'customer_first', 'customer_last'].filter(
      (col) => !c.includes(`${col} IS NULL`),
    )
    expect(
      missing,
      '客人说"删掉我的信息"，只写 redacted_at 而列还在，就是骗人。\n' + missing.join('\n'),
    ).toEqual([])
  })

  it('未脱敏的行至少要有一个匹配键', () => {
    const c = region('CONSTRAINT me_sale_outcomes_needs_match_key')
    expect(
      c.includes('customer_email IS NOT NULL') && c.includes('customer_phone IS NOT NULL'),
      '没有邮箱也没有电话，发给 Meta 100% 匹配不上 —— 白白暴露一次 PII 面。',
    ).toBe(true)
  })

  it('outcome_kind 三种齐全（balance 用于尾款，发自定义事件不计成交数）', () => {
    expect(block).toContain("outcome_kind IN ('purchase','balance','lead')")
  })

  it('没有为异步队列预留的字段（同步发送用不上）', () => {
    // dispatched_at 是给"先落库再发事件"的 outbox 用的。改同步发送后它永远为空，
    // 留着只会让下一个人以为还有一条异步路径。
    expect(SQL.includes('dispatched_at'), 'dispatched_at 属于已砍掉的异步队列').toBe(false)
    expect(SQL.includes('skipped_breaker'), 'skipped_breaker 属于已砍掉的熔断').toBe(false)
  })

  it('client_id 外键不写 ON DELETE CASCADE', () => {
    const fk = /REFERENCES public\.clients\(id\)\s+ON DELETE/.test(block)
    expect(
      fk,
      '这张表是成交事实与审计凭据。删客户时静默级联删掉，等于把已发给 Meta 的记录\n' +
        '在我们这边抹掉，之后再也对不上账。',
    ).toBe(false)
  })
})

describe('#1397 migration · 客户级配置', () => {
  it('conversion_stage 默认 dry_run（新客户不会一上来就真发）', () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS conversion_stage text NOT NULL DEFAULT 'dry_run'")
    expect(SQL).toContain("conversion_stage IN ('dry_run','live')")
  })

  it('加了 default_phone_country（clients 表原本没有这一列）', () => {
    expect(SQL).toContain('ADD COLUMN IF NOT EXISTS default_phone_country text')
  })
})

describe('#1397 migration · 收尾', () => {
  it('发了 NOTIFY pgrst', () => {
    expect(
      SQL.includes("NOTIFY pgrst, 'reload schema'"),
      '不发这一句，PostgREST 眼里没有这些表，第一次读写会拿到「relation does not exist」——\n' +
        '那个报错看起来像「migration 没 apply」，能把人带偏很久。',
    ).toBe(true)
  })

  it('文件里写明了尚未 apply', () => {
    expect(RAW).toContain('尚未 apply')
  })

  it('留了 apply 后的人工自验清单', () => {
    expect(RAW).toContain('apply 之后要人工跑一遍的自验')
  })
})
