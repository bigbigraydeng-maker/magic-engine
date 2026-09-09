'use client'

/**
 * FacebookPagePanel — FDE-managed binding for clients.facebook_page_id.
 *
 * Setting this is what switches the Messenger pipeline on for a client, so the
 * panel says that in those words rather than naming a database column.
 *
 * The hard part for a non-technical operator is that Facebook shows you
 * facebook.com/CTSTOURS while the API needs 1616575215312482, and there is no
 * way to convert one to the other by hand. So the default path is a pick-list of
 * the Pages this client's Meta connection can already act for; typing an id is
 * the fallback, not the main road.
 *
 * Mirrors MetaAdAccountPanel.tsx, which sits next to it in the same drawer.
 */

import React, { useCallback, useEffect, useState } from 'react'

interface Props {
  clientId: string
}

interface ManagedPage {
  id: string
  name: string
}

type PagesError = 'no_token' | 'meta_rejected'

interface Payload {
  page_id: string | null
  /** factory_config.publish_target 里配的发布主页（platform=facebook）。跟收件箱
   *  page_id 是两个独立字段：这个决定「重新授权发布」按钮能不能点。 */
  publish_target_page_id: string | null
  /** 当前环境实际生效的 Meta 应用编号（来自服务端 FACEBOOK_APP_ID），null = 未配置。
   *  「去客户商务组合里添加 Magic Engine 应用」这类提示必须用这个值，不能写死——
   *  测试/预发布环境或应用迁移后这个编号可能跟生产不一样。 */
  meta_app_id: string | null
  pages: ManagedPage[] | null
  pages_error: PagesError | null
  /** Live答案：ME 现在读不读得到这个主页。false = 绑了但拉不到东西。 */
  reachable: boolean | null
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Payload }

/** Why there is no pick-list, said the way an operator can act on. */
const PAGES_ERROR_TEXT: Record<PagesError, string> = {
  no_token:
    '这个客户还没连 Meta 账号，所以列不出主页。可以先手动填 ID；连上之后同步才会开始，连的时候如果报错，按那条提示往下查。',
  meta_rejected:
    '列不出主页 —— Meta 没给我们主页列表，多半是授权过期了。点下面的「连接 Meta」重新授权一次就能恢复列表；急着先绑的话，也可以手动填 ID。',
}

export function FacebookPagePanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState('')
  const [manual, setManual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  /**
   * 保存后的一句话反馈。**故意是 string 不是 ReactNode**（子牙复审 2026-09-03）：
   * 它唯一的来源 describeSave 只返回字符串，而它的容器是下面那个 <p>。放宽成
   * ReactNode 等于开一扇没人走的门，还会引诱下一个人往 describeSave 里塞 <ol>
   * —— 塞进去就是 <p> 里套块级元素，正是 4c0eda7a 刚在 ConnectMeta 修掉的那个
   * 非法嵌套。真要给这条也配排查步骤，先把容器改成 <div> 再放宽类型，别反过来。
   */
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/facebook-page`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Payload
      setState({ phase: 'ready', data })
      setDraft(data.page_id ?? '')
      // No list to pick from → typing is the only road, so open it up front.
      setManual(!data.pages?.length)
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (value: string | null) => {
    setSaving(true)
    setErrMsg(null)
    setResult(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/facebook-page`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: value }),
      })
      const json = (await res.json()) as {
        error?: string
        page_id?: string | null
        reachable?: boolean | null
        pages?: ManagedPage[] | null
        pages_error?: PagesError | null
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      setState({
        phase: 'ready',
        data: {
          page_id: json.page_id ?? null,
          // PATCH only touches the inbox binding — the publish target is a
          // separate field, so carry the last-loaded value through unchanged.
          publish_target_page_id: state.phase === 'ready' ? state.data.publish_target_page_id : null,
          meta_app_id: state.phase === 'ready' ? state.data.meta_app_id : null,
          pages: json.pages ?? null,
          pages_error: json.pages_error ?? null,
          reachable: json.reachable ?? null,
        },
      })
      setDraft(json.page_id ?? '')
      setResult(describeSave(json.page_id ?? null, json.reachable ?? null))
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={() => void load()}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const { page_id, publish_target_page_id, meta_app_id, pages, pages_error, reachable } = state.data

  /**
   * ⚠ 这一段的所有比较只认这两个规范化后的值，别再直接拿 `draft` / `page_id` 比。
   *
   * 子牙复审 2026-09-03 实测：原来 dirty 两边都 trim、draftIsSavedBinding 只 trim
   * 左边，于是 page_id 带一个前导空格就够了 —— 一个**已经生效**的绑定被显示成
   * 「你刚填的、还没保存」，同时保存键灰着，上面红字还在喊「绑了主页但线索进不来」。
   *
   * 而 page_id 确实可能不干净：normalisePageId 只管 PATCH 进来的值，管不住这一列
   * 在 PATCH 端点存在**之前**由 SQL 直写落下的历史数据（见本文件头注释），
   * 后端 GET 也明确只用 trim 判空、返回原值。
   *
   * 同一个值在四个地方用四种口径比较，就会有第四种走法 —— 所以这里定一次口径。
   */
  const draftValue = draft.trim()
  const boundValue = (page_id ?? '').trim()
  const dirty = draftValue !== boundValue

  /**
   * 当前**要显示**的值不在「我们能操作的主页」列表里 —— 常态，不是边角情况：
   * 这正是 reachable=false 那条红字存在的理由。
   *
   * 必须为它单独补一个 <option>，否则 <select value={draft}> 匹配不到任何项，
   * React 回退选中第一项「— 不接私信 —」：屏幕上同时出现「绑了主页，但线索
   * 进不来」和「不接私信」两句自相矛盾的话（2026-09-03 NewAsian 实测）。
   *
   * 更要命的是随之而来的静默改绑：draft 仍等于 page_id，dirty=false、保存键灰着，
   * 人想改都改不了；而他只要在下拉框里动一下，draft 就变成别人的主页 ID 或空，
   * 保存键亮起 —— 一次「确认当前设置」的动作，实际把这个客户改绑到了别的主页。
   *
   * ⚠ 判断必须跟着 `draft`（要显示的值），不能跟着 `page_id`（已保存的值）。
   * 魏征复审 2026-09-03 抓到：第一版挂在 page_id 上只盖住了一半 —— 走「手动填
   * ID → 填一个新的列表外 ID → 回到主页列表」这条路时两者分叉，屏幕又变回
   * 「不接私信」，而这次 dirty=true、保存键是**亮的**，按下去真会把它存进去。
   * 那比原来的 bug 更糟：原来的至少存不进去。
   */
  const draftOutsideList =
    draftValue !== '' && pages !== null && !pages.some((p) => p.id === draftValue)
  /** 这个列表外的值是「已经在生效的绑定」还是「你刚填的、还没存」—— 两件事不能混说。 */
  const draftIsSavedBinding = draftValue === boundValue

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <LiveStatus pageId={page_id} reachable={reachable} />

      <p className="mb-3 text-sm text-slate-600">
        选中客户的 Facebook 主页后，系统每小时自动把主页私信拉进来，AI 写成需求卡，
        显示在<span className="font-bold">「客户消息」</span>页。不选就完全不动这个客户的私信。
      </p>

      {pages_error && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {PAGES_ERROR_TEXT[pages_error]}
        </p>
      )}

      {pages && pages.length > 0 && !manual && (
        <select
          // 用规范化后的值，跟下面 <option> 的 value 同一口径 —— 否则 page_id 带个
          // 空格就又匹配不上，React 回退选中第一项，正是本次要消灭的那个显示 bug。
          // （手填框那边保持原值 draft，实时 trim 会让打字时光标乱跳。）
          value={draftValue}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        >
          <option value="">— 不接私信 —</option>
          {draftOutsideList && (
            <option value={draftValue}>
              {/* 「读不到」直接读 reachable，不在这里第二次推导。今天它跟
                  draftOutsideList 严格互补（都源自同一次响应的 pages），但哪天
                  reachable 改成直接探测主页，两者就会分叉 —— 那时这里会跟上面
                  LiveStatus 说反话，正是本次要消灭的那种自相矛盾（魏征复审）。*/}
              {draftIsSavedBinding
                ? `现在绑的：${draftValue}${reachable === false ? ' —— ME 读不到它' : ''}`
                : `你刚填的：${draftValue} —— 还没保存，按下面「保存」才算数`}
            </option>
          )}
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.id}）
            </option>
          ))}
        </select>
      )}

      {(manual || !pages?.length) && (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="1616575215312482"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        />
      )}

      {pages && pages.length > 0 && (
        <button
          onClick={() => setManual((v) => !v)}
          className="mt-2 text-xs text-slate-500 hover:text-slate-700"
        >
          {manual ? '← 回到主页列表' : '列表里没有？手动填 ID'}
        </button>
      )}

      {errMsg && <p className="mt-2 text-xs leading-relaxed text-red-600">⚠ {errMsg}</p>}
      {result && (
        <p className={`mt-2 text-xs leading-relaxed ${result.ok ? 'text-emerald-600' : 'text-amber-700'}`}>
          {result.text}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void save(draft.trim() || null)}
          disabled={!dirty || saving}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(page_id ?? '')}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            撤销修改
          </button>
        )}
        {!dirty && page_id === null && <span className="text-xs text-slate-400">不接私信</span>}
      </div>

      <ConnectMeta
        clientId={clientId}
        pageId={page_id}
        publishTargetPageId={publish_target_page_id}
        metaAppId={meta_app_id}
      />

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-400">
        主页网址里的名字（facebook.com/<span className="font-mono">CTSTOURS</span>）不是 ID。
        实在要手填，去主页「关于 → 页面透明度」里找「主页编号」。
        保存后最快等一小时出现第一批对话。
      </p>
    </div>
  )
}

/**
 * 客户的 Meta 后台入口。
 *
 * 按 src/lib/pm-todo/action-link.ts 定下的规矩：business.facebook.com 属于登录类
 * 站点，深链不可靠（好坏链接都返回 200，赌错就是一次白跑），所以只给稳定入口，
 * 后面的路径用文字写清楚。
 */
const META_BUSINESS_HOME = 'https://business.facebook.com/'

function BizLink() {
  return (
    <a
      href={META_BUSINESS_HOME}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-cyan-700"
    >
      business.facebook.com
    </a>
  )
}

/**
 * 「拿不到主页」的三条排查，no_pages 和 page_not_granted 共用一份。
 *
 * 拆成列表而不是一段流水字（板桥复审）：人要拿着这个在客户后台和本面板之间来回
 * 切，挤成一坨 12px 小字会找不回读到哪。
 *
 * ①②要动的都是**客户的**后台，运营人员多半没权限 —— 所以末尾必须明说「这两步
 * 得客户自己点」，否则等于把人堵在一扇他打不开的门前（CLAUDE.md 铁律 3）。
 *
 * 名词一律跟 Meta 后台对齐，且对不确定的显示名都给出退路：应用名可能不叫
 * Magic Engine（按编号找）、「主页访问权限」在有的界面写「页面访问权限」。
 * 这类防御要么都给要么都不给 —— 只给一半，没给的那半就是下一个卡点。
 */
function TroubleshootSteps({
  metaAppId,
  showPageIdCheck = true,
}: {
  metaAppId: string | null
  /**
   * 要不要显示第③条「主页 ID 是不是填错了」。
   *
   * no_pages 传 false（子牙复审 2026-09-03）：callback 在 `pages.length === 0` 处
   * 就 return 了（route.ts:81），而读 clients.facebook_page_id 在那之后（:92）——
   * 走到 no_pages 时服务端**从没拿主页 ID 跟任何东西比过**，所以「ID 填错」在
   * 逻辑上不可能是原因。让人去查一件已知无关的事，就是这次改动自己反对的
   * 「把人引向死路」，只是程度轻。
   *
   * ①② 对 no_pages 仍然成立（组合里没加应用、账号名下真没主页，都会让
   * /me/accounts 返回空），所以只摘这一条，不整块拆。
   */
  showPageIdCheck?: boolean
}) {
  return (
    <>
      <ol className="mt-1.5 list-decimal space-y-1.5 pl-4">
        <li>
          客户的<span className="font-bold">商务组合</span>里有没有把 Magic Engine 这个应用加进去 ——
          请客户打开 <BizLink />，左边「设置」→「应用」→ 添加。
          {/* 应用编号来自服务端的 FACEBOOK_APP_ID，不写死（另一窗口 0b3ec4b1 的
              修正，我认）：硬编码的编号在测试/预发布/应用迁移后与生产不一致，
              照着提示做会把**错的**应用加进客户的商务组合，白跑一趟还查不出为什么。*/}
          {metaAppId ? (
            <>
              应用编号 <span className="font-mono">{metaAppId}</span>；
              后台显示的名字不一定就叫 Magic Engine，按编号找最稳。
            </>
          ) : (
            <>当前环境没配 FACEBOOK_APP_ID，报给工程团队要一下应用编号再动手 —— 按名字找容易加错应用。</>
          )}
        </li>
        <li>
          客户在商务组合里把主页「分给」你，跟客户在主页本身把你加成管理人，
          <span className="font-bold">是两件事，只有后者才够</span>。
          要客户在主页设置的「主页访问权限」（有的界面写「页面访问权限」）里，
          把你加成有完全控制权限的人（有的界面写「管理员」）。
        </li>
        {showPageIdCheck && <li>上面那个主页 ID 是不是手填错了、或者登错了账号。</li>}
      </ol>
      <p className="mt-1.5">
        ①②这两步都得<span className="font-bold">客户自己去点</span>，你没权限 ——
        可以把这段话原样复制发给他。
      </p>
    </>
  )
}

/**
 * What the callback redirected back with, said the way the operator needs it.
 *
 * text 是 ReactNode 而不是 string：这些提示要指导人去客户的 Meta 后台点几下，
 * 按 CLAUDE.md 铁律 3，下发给人的任务要带 what / how / href 三件套 —— 纯字符串
 * 放不下链接，也没法把三条排查拆成看得清的列表（板桥复审 2026-09-03：300 多字
 * 挤成一坨 12px 小字，人在客户后台和这个面板之间来回切时找不回读到哪）。
 */
function metaResult(
  metaAppId: string | null,
): Record<string, { ok: boolean; text: React.ReactNode }> {
  return {
  connected: { ok: true, text: '✓ 连接成功。下一个整点开始同步这个主页的私信。' },
  publish_ready: {
    ok: true,
    // Meta granting the app-level scope is necessary but not sufficient: the
    // Page token can still lack the Page-level task to actually post. So this
    // states what was proven (scope granted) and what is not yet proven
    // (Page-level publishing), left to the separately-authorised draft canary.
    text: '✓ Meta 已授予发布权限（管理主页帖子）。能不能真正发到这个主页，还要靠之后单独授权的那次「试发草稿」来确认 —— 在那之前不代表已经能发。',
  },
  publish_not_granted: {
    ok: false,
    text: '连接成功了，但这次授权没有勾选「管理主页帖子」，所以还不能发内容（私信同步不受影响）。请再点一次「重新授权 Meta 发布权限」，在 Meta 授权页把发帖权限一起勾上。',
  },
  verify_failed: {
    ok: false,
    text: '刚才没能跟 Meta 核实这次授权到底给了哪些权限，所以没有改动这个连接（避免记错状态）。请稍等一下再点一次。',
  },
  no_publish_target: {
    ok: false,
    text: '这个客户还没配好「发布到哪个 Facebook 主页」，所以没法发起发布授权。请先在「视频工厂配置」里把发布主页填好，再点「重新授权 Meta 发布权限」。',
  },
  denied: { ok: false, text: '授权取消了，没有任何改动。要接私信的话再点一次。' },
  // ⚠ 下面两条的措辞是 2026-09-03 NewAsian 事故后重写的。
  //
  // 旧文案只给了「换个账号」和「查主页 ID」两个方向。实测时两个都是对的却仍然
  // 失败：主页 ID 正确（Meta 按广告账户查返回的就是它）、授权账号在 Business
  // Suite 里也确实看得到该主页的消息 —— 真因是客户的商务组合里从没添加过
  // Magic Engine 这个应用，应用因此拿不到该组合下任何主页的令牌。
  //
  // 一条把人引向死路的提示比没有提示更贵：排查的人会反复确认那两件本来就没错
  // 的事。所以这里按实测的可能性排序，把最常中的原因放第一条。
  no_pages: {
    ok: false,
    // ⚠ 措辞刻意不写成「Meta 说没有主页」。listPagesWithTokens 在 Meta 报错或
    // 网络抖动时同样 return []（见 meta-oauth/client.ts），callback 只看
    // length===0，所以这条也可能是一次抖动。把它说成 Meta 的确定回答，会让人
    // 拿着一个不存在的结论去改客户后台的配置。
    text: (
      <>
        <p>
          授权走完了，但我们没从这个账号拿到任何主页。可能只是 Meta 当时没答上来 ——
          先隔几分钟重新点一次「连接 Meta」。
        </p>
        <p className="mt-1">还是这样的话，按顺序查：</p>
        <TroubleshootSteps metaAppId={metaAppId} showPageIdCheck={false} />
      </>
    ),
  },
  page_not_granted: {
    ok: false,
    // 2026-09-03 NewAsian 实测：主页 ID 正确、授权账号在 Business Suite 里也看得到
    // 该主页消息，仍然失败 —— 真因是客户的商务组合里没添加 Magic Engine 应用。
    // 旧文案只给「换账号 / 查 ID」两条路，把人引向死路。
    //
    // 但也不能反过来断言「跟 ID 无关」（魏征复审）：本面板在列不出主页时默认就
    // 打开手填框，而 normalisePageId 只校验「≥8 位数字」，手打错一个数字照样存得
    // 进去 —— 手填错 ID 恰恰是这个界面自己制造的一类常见原因。所以三条并列摆出
    // 来，只说「先查哪条」，不替人排除任何一条。
    //
    // publishing 那句提到最前面当分流（板桥复审）：它原来挂在末尾无条件显示，
    // 读到的人得回头重判前面①②③还算不算数。这张表拿不到 intent，所以做不到
    // 真正分岔，只能让人自己先分清点的是哪个按钮。
    text: (
      <>
        <p>
          <span className="font-bold">先分清你刚点的是哪个按钮。</span>
          如果点的是「重新授权 Meta 发布权限」：它认的不是这个面板上绑的主页，而是
          「视频工厂配置」里那个发布主页 —— 下面第③条对你不适用，要查的是那边那个 ID。
          如果点的是「连接 Meta」，往下看。
        </p>
        <p className="mt-1.5">授权走完了，但 Meta 没把这个主页交给我们。三个方向都查一下：</p>
        <TroubleshootSteps metaAppId={metaAppId} />
      </>
    ),
  },
  no_page_bound: { ok: false, text: '还没绑定主页 —— 先在上面选好主页并保存，再点连接。' },
  bad_state: { ok: false, text: '这个连接链接已经过期了，请重新点一次「连接 Meta」。' },
    exchange_failed: { ok: false, text: 'Meta 那边没有换出凭证，请稍后再试一次。' },
  }
}

/**
 * The one-click replacement for hand-editing a server environment variable.
 *
 * Every client used to need META_SYSTEM_USER_TOKEN_PAGE_<id> added to Render by
 * hand, which CLAUDE.md forbids for FDE configuration and which nobody did — so
 * 30 Kiteroa spent real money with its inbox unreachable. One consent here
 * stores the Page token for good.
 */
function ConnectMeta({
  clientId,
  pageId,
  publishTargetPageId,
  metaAppId,
}: {
  clientId: string
  pageId: string | null
  publishTargetPageId: string | null
  /** 当前环境实际生效的 Meta 应用编号（GET 返回的 meta_app_id）。
   *  往下传给 metaResult() → TroubleshootSteps，用来告诉操作员该把哪个应用加进
   *  客户的商务组合。null = 这套环境没配 FACEBOOK_APP_ID，那时不能让人凭应用
   *  名去找（容易加错应用），要明说去问工程团队要编号。 */
  metaAppId: string | null
}) {
  const [outcome, setOutcome] = useState<string | null>(null)
  // Publishing reauth targets factory_config.publish_target, so it is available
  // whenever a valid Facebook publish target is configured — independent of the
  // inbox binding (which may be unset or a different Page).
  const canReauthPublish = Boolean(publishTargetPageId)

  // The callback hands its verdict back through the URL; read it once, then
  // strip it so a refresh does not replay a stale message.
  useEffect(() => {
    const url = new URL(window.location.href)
    const meta = url.searchParams.get('meta')
    if (!meta) return
    setOutcome(meta)
    url.searchParams.delete('meta')
    window.history.replaceState({}, '', url.toString())
  }, [])

  // 应用编号必须是这套部署真实的 FACEBOOK_APP_ID，不能写死字面量，否则在编号
  // 不同的环境（测试/预发布/应用迁移后）会指挥人把错的应用加进客户商务组合。
  //
  // 传参而不是 {{META_APP_ID}} 字符串替换：这些提示已经是 ReactNode（要放可点
  // 链接和有序列表），字符串 replace 对 JSX 不生效，会把占位符原样显示给用户。
  const result = outcome ? metaResult(metaAppId)[outcome] ?? null : null

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {result && (
        <div
          className={`mb-2 text-xs leading-relaxed ${result.ok ? 'text-cyan-700' : 'text-amber-700'}`}
        >
          {result.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/auth/facebook/connect?client_id=${clientId}`}
          className={`inline-block rounded-lg border px-3 py-1.5 text-xs font-bold ${
            pageId
              ? 'border-cyan-300 bg-white text-cyan-700 hover:bg-cyan-50'
              : 'pointer-events-none border-slate-200 bg-slate-50 text-slate-300'
          }`}
          aria-disabled={!pageId}
        >
          连接 Meta
        </a>

        {/* Same OAuth flow, but carries intent=publishing so the callback fails
            closed with a publishing-specific message if 管理主页帖子 isn't granted.
            Needed for clients (e.g. inbox-only connects made before publishing
            scope existed) whose stored grant lacks pages_manage_posts. */}
        <a
          href={`/api/auth/facebook/connect?client_id=${clientId}&intent=publishing`}
          className={`inline-block rounded-lg border px-3 py-1.5 text-xs font-bold ${
            canReauthPublish
              ? 'border-cyan-300 bg-white text-cyan-700 hover:bg-cyan-50'
              : 'pointer-events-none border-slate-200 bg-slate-50 text-slate-300'
          }`}
          aria-disabled={!canReauthPublish}
        >
          重新授权 Meta 发布权限
        </a>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        {/* 同一句死路的第二个副本，而且就贴在按钮下面 —— 是点之前最后读到的一句，
            比顶部那句更容易让人「确认自己没做错」然后再换个账号白跑一次。*/}
        {pageId
          ? '用一个管得了这个主页的账号授权一次。顺利的话之后就不用再管；不顺利的话，上面会写清楚接着查哪里。'
          : '先选好主页并保存，才能连接私信。'}
        {canReauthPublish
          ? '「重新授权 Meta 发布权限」针对的是视频工厂配置里那个发布主页，授权时记得勾上发帖权限。'
          : '要让系统能发内容，得先在「视频工厂配置」里配好发布主页，这个按钮才能点。'}
      </p>
    </div>
  )
}

/**
 * Standing answer to "is this actually working right now", shown on every load.
 *
 * The failure it exists for is silent: a Page can be bound while the client has
 * only granted us permission to *advertise* with it, not to read its inbox. Ads
 * spend, nothing arrives, and every screen looks normal. 30 Kiteroa sat like
 * that with money going out and zero conversations in ME. The save-time message
 * did say it once, but it disappeared on the next load — so this repeats it for
 * as long as it is true, and names the fix rather than just the symptom.
 */
function LiveStatus({ pageId, reachable }: { pageId: string | null; reachable: boolean | null }) {
  if (pageId === null) return null

  if (reachable === true) {
    return (
      <p className="mb-3 rounded-lg bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800">
        ✓ 私信正在同步 —— ME 读得到这个主页。
      </p>
    )
  }

  if (reachable === false) {
    return (
      <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
        <p>
          <span className="font-bold">⚠ 绑了主页，但线索进不来。</span>
          <br />
          ME 读不到这个主页，所以私信一条都同步不进来 —— 广告照跑照花钱，客人发来的消息只留在对方主页的收件箱里。
        </p>
        {/* ⚠ 这句原本写的是「用一个能看到这个主页消息的账号授权一次就好」。
            2026-09-03 NewAsian 实测把它证伪了：授权账号在 Business Suite 里就是
            看得到该主页消息，照样失败（真因是客户商务组合里没加 Magic Engine 应用）。
            板桥复审指出，这句在红框里、加粗、位置最靠上，人会先信它 —— 于是先白跑
            两趟换账号，再回头才注意到中间那段真正的排查指引，而且那时对它的信任
            已经打折。修下拉框却留着这句，等于修了一半。*/}
        <p className="mt-1.5">
          先点下面的「连接 Meta」重新授权一次。授权完还是这样的话，
          <span className="font-bold">别急着换账号</span> ——
          这个账号在 Business Suite 里看得到消息，也不一定够。到时候按下面那条提示往下查。
        </p>
      </div>
    )
  }

  return (
    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
      绑了主页，但现在连不上 Meta，没法确认同步是不是正常。多半过一会儿自己好；十几分钟后刷新还是这样，点下面的「连接 Meta」重新授权一次。
    </p>
  )
}

/** One sentence covering saved-and-live, saved-but-not-live, and unbound. */
function describeSave(pageId: string | null, reachable: boolean | null): { ok: boolean; text: string } {
  if (pageId === null) {
    return { ok: true, text: '✓ 已解除绑定，之后不会再同步这个客户的私信。' }
  }
  if (reachable === true) {
    return { ok: true, text: '✓ 已保存，ME 能读到这个主页。下一个整点开始同步私信。' }
  }
  if (reachable === false) {
    // ⚠ 原文是「多半是这个 ID 不属于已连接的 Meta 账号，或者授权没覆盖到它…请找
    // 团队确认」。两个毛病：一是用「多半」给一个已被实测推翻的原因押了高置信度，
    // 跟同屏那段「三条都查、不替你排除任何一条」的排查指引给出相反的排序；二是
    // 「请找团队确认」把人指向一个不存在的下家 —— 看这个面板的人就是团队，
    // 这是 CLAUDE.md 铁律 3 说的管道断头（板桥复审 2026-09-03）。
    return {
      ok: false,
      text: '已保存，但 ME 现在读不到这个主页 —— 私信一条也进不来。下一步：点下面的「连接 Meta」重新授权一次；授权完还是读不到的话，按那时候出来的提示往下查。',
    }
  }
  return { ok: false, text: '已保存。Meta 还没连上，接通之后同步才会开始。' }
}
