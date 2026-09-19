'use client'

/**
 * /dashboard/clients/[id]/settings —— 客户配置中心。
 *
 * ## 2026-08-03 改成分页签（PM：「当前的页面太长，不好用」）
 *
 * 原先是 **23 个板块堆在一根 768px 的竖列里，全部展开**。人来这一页永远是为了
 * 办一件事，却要从 22 个不相干的板块里滚过去；而且每个板块自己 fetch 自己的
 * 数据，打开一次同时发 20 多个请求。
 *
 * 现在按「你来干什么」分五组，**只挂载当前这一组** —— 不是把别的藏起来，是
 * 根本不渲染，所以那些请求压根不会发出去。分组和页签逻辑在 `SettingsTabs`。
 *
 * ## URL 参数
 *
 *   ?tab=connect|profile|crm|content|advanced   落在哪一组
 *   ?gbp=connected / needs_location / error     商家页授权回跳
 *   ?mail=ok / admin_ok / error                 邮箱授权回跳（见 MailboxPanel）
 *
 * 带 `gbp` 或 `mail` 时**强制落在「接通」** —— 那两条的提示都渲染在那一组里，
 * 落错组的话人授权完看到的是一片跟他无关的东西，会以为没成功。
 */

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { ClientStatusPanel } from './_components/ClientStatusPanel'
import { GbpPanel } from './_components/GbpPanel'
import { GbpLocationPanel } from './_components/GbpLocationPanel'
import { GscPanel } from './_components/GscPanel'
import { GscPropertyPanel } from './_components/GscPropertyPanel'
import { Ga4Panel } from './_components/Ga4Panel'
import { Ga4PropertyPanel } from './_components/Ga4PropertyPanel'
import { GoogleAdsPanel } from './_components/GoogleAdsPanel'
import { DataSnapshotPanel } from './_components/DataSnapshotPanel'
import { OtherDataSourcesPanel } from './_components/OtherDataSourcesPanel'
import { CmsPanel } from '../_components/CmsPanel'
import { MailboxPanel } from './_components/MailboxPanel'
import { AdStrategyPanel } from './_components/AdStrategyPanel'
import { AdOutcomePanel } from './_components/AdOutcomePanel'
import { CompetitorDomainsPanel } from './_components/CompetitorDomainsPanel'
import { ReputationIdentityPanel } from './_components/ReputationIdentityPanel'
import { PrimaryKeywordsPanel } from './_components/PrimaryKeywordsPanel'
import { BrandAliasesPanel } from './_components/BrandAliasesPanel'
import { SocialHandlesPanel } from './_components/SocialHandlesPanel'
import { ApiKeysPanel } from './_components/ApiKeysPanel'
import { ExcludedTopicsPanel } from './_components/ExcludedTopicsPanel'
import { WeeklyBlogPanel } from './_components/WeeklyBlogPanel'
import { BrandRedlinesPanel } from './_components/BrandRedlinesPanel'
import { IndustryPanel } from './_components/IndustryPanel'
import { ProductsPanel } from './_components/ProductsPanel'
import { UploadLinkPanel } from './_components/UploadLinkPanel'
import { FactoryConfigPanel } from './_components/FactoryConfigPanel'
import { CommentAutoReplyPanel } from './_components/CommentAutoReplyPanel'
import { LeadsConfigPanel } from './_components/LeadsConfigPanel'
import { MailchimpAudiencePanel } from './_components/MailchimpAudiencePanel'
import { LeadNotifyEmailsPanel } from './_components/LeadNotifyEmailsPanel'
import { DomainRulesPanel } from './_components/DomainRulesPanel'
import { PipelineStagesPanel } from './_components/PipelineStagesPanel'
import { CommentAuditList } from './_components/CommentAuditList'
import { MessengerEmergencyStopPanel } from './_components/MessengerEmergencyStopPanel'
import {
  SettingsSection,
  SettingsTabBar,
  useSettingsTab,
  type SettingsTab,
} from './_components/SettingsTabs'

const ERROR_MESSAGES: Record<string, string> = {
  token_exchange_failed: 'Google 那边没给我们通行证，请再试一次。',
  gbp_api_failed:        'Google 拒绝了这次连接，多半是这个账号没有管理这家商家页的权限 —— 换成客户老板的账号再试一次。',
  no_gbp_accounts:       '这个 Google 账号名下没有任何商家页 —— 十有八九是登错账号了，退出 Google 换客户老板的账号重来。',
}

/**
 * 当前这一组的内容。
 *
 * **必须是一个函数、按 tab 分支返回**，不能把五组都渲染出来再用 CSS 藏 ——
 * 藏起来的板块照样会挂载、照样会发请求，那就白改了。
 */
/**
 * 授权/连接回跳时，本来就是来看「成没成」的那一块——默认展开，
 * 不用先点开才看得到结果（其余板块照旧默认收起，见 SettingsSection）。
 */
interface ConnectCallbacks {
  mail: boolean
  gbp: boolean
  oauth: boolean
}

function TabBody({
  tab,
  clientId,
  callbacks,
}: {
  tab: SettingsTab
  clientId: string
  callbacks: ConnectCallbacks
}) {
  switch (tab) {
    case 'connect':
      return (
        <>
          <SettingsSection first icon="🚦" title="真客户 / 调研档案">
            <ClientStatusPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="✉️" title="公司邮箱（客人发来的信）" defaultOpen={callbacks.mail}>
            <MailboxPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="📍" title="Google Business Profile" defaultOpen={callbacks.gbp}>
            <GbpPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🏪" title="发到哪一家门店" defaultOpen={callbacks.gbp}>
            <GbpLocationPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🔎" title="Google Search Console" defaultOpen={callbacks.oauth}>
            <GscPanel clientId={clientId} />
            <div className="mt-3"><GscPropertyPanel clientId={clientId} /></div>
            <div className="mt-3"><DataSnapshotPanel anchor="gsc" clientId={clientId} /></div>
          </SettingsSection>
          <SettingsSection icon="📈" title="Google Analytics 4" defaultOpen={callbacks.oauth}>
            <Ga4Panel clientId={clientId} />
            <div className="mt-3"><DataSnapshotPanel anchor="ga4" clientId={clientId} /></div>
          </SettingsSection>
          <SettingsSection icon="📊" title="同步哪一个 GA4 Property" defaultOpen={callbacks.oauth}>
            <Ga4PropertyPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="📢" title="Google Ads">
            <GoogleAdsPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🩺" title="广告健康监测">
            <AdStrategyPanel clientId={clientId} />
            <div className="mt-3"><AdOutcomePanel clientId={clientId} /></div>
          </SettingsSection>
          <SettingsSection icon="🌐" title="网站连接（GitHub / WordPress / Shopify）">
            <CmsPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🔗" title="其他数据来源">
            <OtherDataSourcesPanel clientId={clientId} />
          </SettingsSection>
        </>
      )

    case 'profile':
      return (
        <>
          <SettingsSection first icon="🏢" title="所属行业（决定 AI 读不读同行经验）">
            <IndustryPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="📦" title="主力产品（AI 写文案时逐条读）">
            <ProductsPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🎯" title="主关键词清单">
            <PrimaryKeywordsPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🏷️" title="品牌词别名">
            <BrandAliasesPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🥊" title="竞品域名清单">
            <CompetitorDomainsPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="⭐" title="口碑监测身份（GBP / Tripadvisor / 竞品）">
            <ReputationIdentityPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🚫" title="排除品类词（关键词 gap 过滤）">
            <ExcludedTopicsPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="⛔" title="品牌红线短语（内容工厂拒单闸）">
            <BrandRedlinesPanel clientId={clientId} />
          </SettingsSection>
        </>
      )

    case 'crm':
      return (
        <>
          <SettingsSection first icon="🪜" title="客人跟进步骤">
            <PipelineStagesPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🤝" title="谁是自己人 / 谁是同行（按邮箱域名认）">
            <DomainRulesPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="📮" title="Meta 广告线索送进哪个 Mailchimp 名单">
            <MailchimpAudiencePanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="📧" title="邮件反应同步（谁打开了 / 谁点了链接）">
            <LeadsConfigPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="📨" title="网站表单来了新客资，发邮件通知谁">
            <LeadNotifyEmailsPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="📤" title="客户素材上传链接（免登录）">
            <UploadLinkPanel clientId={clientId} />
          </SettingsSection>
        </>
      )

    case 'content':
      return (
        <>
          <SettingsSection first icon="📱" title="社媒账号（Instagram · Facebook · TikTok）">
            <SocialHandlesPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="📝" title="每周自动 Blog（SEO 盯梢）">
            <WeeklyBlogPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🎬" title="视频工厂配置（出片 / 发片）">
            <FactoryConfigPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="💬" title="Facebook 评论自动回复">
            <CommentAutoReplyPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🗂️" title="最近自动回复（审计）">
            <CommentAuditList clientId={clientId} />
          </SettingsSection>
        </>
      )

    case 'advanced':
      return (
        <>
          <SettingsSection first icon="🔌" title="MCP API 访问">
            <ApiKeysPanel clientId={clientId} />
          </SettingsSection>
          <SettingsSection icon="🚨" title="AI 客服自动回复 · 紧急全渠道停">
            <MessengerEmergencyStopPanel clientId={clientId} />
          </SettingsSection>
        </>
      )
  }
}

export default function ClientSettingsPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const [tab, pickTab] = useSettingsTab()

  const clientId = params.id
  const gbpStatus = searchParams.get('gbp')
  const gbpReason = searchParams.get('reason') ?? ''
  // GSC/GA4 合并授权（/api/auth/google/callback）回跳带的是 ?oauth=，不是
  // ?gbp=——PR5 复审发现这条错误提示之前直接消失了，补上一个通用版本。
  const oauthStatus = searchParams.get('oauth')
  // 邮箱授权回跳（见 MailboxPanel）——用它来判断该默认展开哪一块，不用来
  // 渲染横幅（那条横幅在 MailboxPanel 自己里面）。
  const mailStatus = searchParams.get('mail')

  const errorMessage =
    gbpStatus === 'error' ? (ERROR_MESSAGES[gbpReason] ?? '连接过程中发生未知错误，请重试。') : null

  return (
    <div className="min-h-screen bg-[#f6f7f2]">
      {/* 原先是 max-w-3xl（768px）—— 分组之后内容变短，宽一点少一半的滚动。 */}
      <div className="mx-auto max-w-4xl px-5 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <Link
            href={`/dashboard/clients/${clientId}`}
            className="font-medium text-cyan-700 hover:underline"
          >
            ← 返回客户主页
          </Link>
        </div>

        <h1 className="text-2xl font-black text-slate-950">客户配置中心</h1>

        {gbpStatus === 'connected' && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <span className="text-xl">✅</span>
            <div>
              <p className="font-black text-emerald-800">Google 商家页已连接，门店也确认好了！</p>
              <p className="mt-0.5 text-sm text-emerald-700">
                线已经接通。接下来我们会把每周要发的商家页内容写好，放进你的今日待办等你点确认 ——
                你不点，就不会有任何东西发到客户的 Google 页面上。
              </p>
            </div>
          </div>
        )}

        {gbpStatus === 'needs_location' && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="font-black text-amber-800">连上了，但还差最后一步：我们没认出是哪一家门店</p>
              <p className="mt-0.5 text-sm text-amber-700">
                这个 Google 账号下面挂了不止一家门店，名字和网址都对不上，我们不敢猜 ——
                猜错就会把内容发到别人家的页面上。在确认之前，我们一条内容都不会发。
              </p>
              <p className="mt-1.5 text-sm font-bold text-amber-800">
                下一步：把客户名字和正确的门店名发给 Ray，我们指定一下，一般当天就能好。
              </p>
            </div>
          </div>
        )}

        {gbpStatus === 'error' && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <span className="text-xl">❌</span>
            <div>
              <p className="font-black text-red-800">连接失败</p>
              <p className="mt-0.5 text-sm text-red-700">{errorMessage}</p>
            </div>
          </div>
        )}

        {oauthStatus === 'success' && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <span className="text-xl">✅</span>
            <div>
              <p className="font-black text-emerald-800">Google 账号已授权</p>
              <p className="mt-0.5 text-sm text-emerald-700">
                授权已经收到。GA4 还要在下方选定并验证 Property，验证通过后才会显示已连接。
              </p>
            </div>
          </div>
        )}

        {(oauthStatus === 'error' || oauthStatus === 'denied') && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <span className="text-xl">❌</span>
            <div>
              <p className="font-black text-red-800">
                {oauthStatus === 'denied' ? '授权被取消' : '连接失败'}
              </p>
              <p className="mt-0.5 text-sm text-red-700">
                {oauthStatus === 'denied'
                  ? '你在 Google 那边取消了授权，下面重新点一次「连接」就行。'
                  : 'Google 那边没给我们通行证，请再试一次。'}
              </p>
            </div>
          </div>
        )}

        <SettingsTabBar active={tab} onPick={pickTab} />

        <div className="mt-6">
          <TabBody
            tab={tab}
            clientId={clientId}
            callbacks={{ mail: mailStatus !== null, gbp: gbpStatus !== null, oauth: oauthStatus !== null }}
          />
        </div>
      </div>
    </div>
  )
}
