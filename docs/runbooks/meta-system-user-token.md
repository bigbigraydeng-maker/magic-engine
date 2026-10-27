# Meta 系统用户令牌 — Claude 用 Ray 的浏览器操作

给 Claude Code 用。Ray 必须在场。这一页只修令牌这一闸，让已有的 Facebook 主页、广告草稿/读取、线索进 CRM 能重新拿到一把活的系统用户令牌。

不发帖，不建广告，不开投，不花钱，不改数据库，不把令牌写进聊天、GitHub、截图或日志。

旧说明 [`docs/sops/meta-system-user-token-setup.md`](../sops/meta-system-user-token-setup.md) 已过期：它按客户各做一把、资产勾完全控制、还要求建一条暂停广告来验权限。不要照那份做。

系统地图在 PR #3104 的 `docs/ARCHITECTURE.md` §7（尚未进 main）。这一页只碰社媒、广告、以及线索进 CRM 的已有路径。

## 令牌放哪里

代码实际读取的位置，只写名字：

| 用途 | 代码读哪里 | 这次放不放 |
|---|---|---|
| 共享系统用户令牌（广告读取、没有主页令牌时换页令牌） | Render 环境变量 `META_SYSTEM_USER_TOKEN` | **放这里** |
| 「连接 Meta」存下的主页令牌 | 表 `platform_oauth_connections` 列 `access_token_enc`（`provider = meta` 且 `status = active`） | **不放**。没有把系统用户令牌写进这列的现成入口 |
| 按域名 / 按主页 / 按客户名的旧环境变量 | `META_SYSTEM_USER_TOKEN_<域名键>`、`META_SYSTEM_USER_TOKEN_PAGE_<主页>`、`<客户名>_META_SYSTEM_USER_TOKEN` | **不新建、不改值**。`resolveMetaTokenDetailed` 会优先用它们，共享令牌根本不会被这些客户用到。只许看 Render 里**有哪些键名**，不许打开值 |

依据：`src/lib/meta/token-selection.ts` 的 `resolveMetaTokenDetailed`、`loadStoredPageToken`；`src/lib/factory/publish/facebook-reel-adapter.ts` 的 `resolveToken`（先库里的主页令牌，没有才用 `META_SYSTEM_USER_TOKEN` 向 `/{page-id}?fields=access_token` 换页令牌）；`src/lib/pm-todo/meta-token-health-items.ts` 把公共钥匙写成 `META_SYSTEM_USER_TOKEN`。

因此：连接行 `status` 仍是 `active` 时，死掉的主页令牌会继续被用，新的系统用户令牌帮不上这条主页。#3076 会把 Graph 190 标成 `error` 并停止重试，但该 PR 还没合并，迁移也没进生产。这次不要改那些行。

## 最小权限

只勾下面这些。界面措辞对不上时，按「能做这件事、不能管付款、不是完全控制」来认；认不出就停，写成待确认，不要改勾完全控制。

系统用户本身的角色用 **Admin**。旧 SOP 写过 Employee 调不了 `ads_management`。这是角色，不是下面每个资产的完全控制。

### 生成令牌时勾的权限

从调用 Graph 的代码归纳，不是从旧 SOP 抄的。

| 闭环要做的事 | 勾这些 | 代码 |
|---|---|---|
| 认出主页、换页令牌 | `pages_show_list` | `src/lib/meta/page-posts.ts` 的 `/me/accounts`；工厂在没有库内主页令牌时换页令牌 |
| 发主页帖 / Reel | `pages_manage_posts` | `src/lib/meta/page-posts.ts`；`src/lib/social/facebook-publisher.ts` 的 `/{page}/feed`；工厂 `video_reels` |
| 拉互动计数 | `pages_read_engagement` | `src/lib/meta/post-engagement.ts`（写明只用这一条） |
| 读线索表单 | `leads_retrieval`、`pages_manage_ads` | `src/lib/meta/lead-forms.ts`。2026-08-30 生产报错：有 `leads_retrieval` 仍要 `pages_manage_ads` 才能列出表单 |
| 读私信 | `pages_messaging` | `src/lib/meta/conversations.ts`（还要 `pages_read_engagement`） |
| 读广告数据 | `ads_read` | `src/lib/meta/campaign-insights.ts` 的 `/{ad-account}/insights` |
| 起草暂停广告（这次不执行） | `ads_management` | `src/lib/meta/ad-publisher.ts` 的 `publishDraftPaused` |
| 系统用户能挂上业务资产 | `business_management` | 现有体检文案 `src/lib/pm-todo/meta-token-health-items.ts` 要求勾。`verifyAdAccountAccessible` 写明缺它仍可能读到账户。界面没有这项就标待确认，不要为此改开完全控制 |

明确不勾：

- `read_insights` — `post-engagement.ts` 写明不碰它
- `pages_manage_engagement`、`pages_read_user_content` — 回评论 / 读客人评论正文要用（`META_PAGE_SCOPES`）。#3092 的「示例客户 G」缺的就是回评论。不在这条闭环的最小集里
- `whatsapp_business_management` — 另一条线

### 分配资产时勾的任务

| 资产 | 勾 | 不勾 |
|---|---|---|
| 每个已接入的客户主页 | 发内容（对应 `pages_manage_posts`）、看互动（`pages_read_engagement`）、私信（`pages_messaging`）、广告/表单（`pages_manage_ads`） | 完全控制；版主/审核（那是回评论） |
| 每个已接入的广告账户 | 查看效果（`ads_read`）、建和改广告但不含付款（`ads_management`，用来起草暂停广告） | 完全控制、管付款方式 |

主页或广告账户在客户自己的业务管理平台里、这个系统用户的业务管理平台分配列表里找不到：停，标待确认。不要新建业务管理平台，不要发合伙邀请，不要把资产所有权转走。

## 浏览器步骤

Ray 坐在旁边，看完每一步再点。Claude 操作 Ray 已登录的 Chrome。

1. 打开 `https://business.facebook.com/settings/system-users`。业务切到**已经挂着 Magic Engine 应用**的那个。下拉里有多家、分不清哪家挂着应用：停，标待确认。不要新建业务。
2. 已有名为 `MagicEngine` 的系统用户就用它（体检文案里的名字）。没有才新建：名字 `MagicEngine`，角色 Admin。不要用「Conversions API System User」，也不要按旧 SOP 再建一个 `Magic Engine Ads`。
3. 按上一节，把每个已接入客户的主页和广告账户分配给这个系统用户。对照下面的清单。对不上的行不要猜。
4. 生成口令：选 Magic Engine 应用（有两个同名应用就停，标待确认，不要新建应用）；到期选永不；权限只勾上一节那一张表。
5. 口令只显示一次。**Ray 自己**贴进 Render。Claude 不读、不复述、不写进对话、不截有口令的屏、不贴到 GitHub 或日志。画面上出现口令时，Claude 把视线挪开，等 Ray 说已经贴完。
6. Render：打开已经有键 `META_SYSTEM_USER_TOKEN` 的那个网站服务。体检文案写的服务名是 `crazycontent`；以「这个键已经在哪」为准，不要在第二个服务再加一把。Environment 里只改这个键的值。保存时选会重新部署的那一项，不要只保存。键不存在才新增同名键。
7. 保存后只确认：键名还在，值是掩码。不要把值展开。

## 每客户清单

#3092（2026-10-25）写：已绑主页的在服务客户 7 家，完全正常 2 家。正文用代号，没有真名。这次不查生产库，所以真名一律待确认。7 与下表 6 行对不上（2 家正常没有点名），也标待确认。

| #3092 代号 | 主页连接 | 断在哪 | 真名 / 客户 id |
|---|---|---|---|
| 示例客户 B | 库里仍是 `active`，令牌已被作废（190） | 私信、线索、主页数据全断；每小时还在重试 | 待确认 |
| 示例客户 C | `error`（190） | 只剩共享令牌，被主页归属闸拦下；私信、线索全停 | 待确认 |
| 示例客户 D | `error`（190/460） | 授权人会话失效；私信、线索全停 | 待确认 |
| 示例客户 E | `error`（190/460） | 落到一把没有 `pages_messaging` 的环境变量令牌；线索还在，私信全停 | 待确认 |
| 示例客户 F | 从没连过 Meta | 私信权限错误，主页数据读不到；视频工厂已经给它出过片 | 待确认 |
| 示例客户 G | 能用 | 缺 `pages_manage_engagement`，不能回评论。这条不在本次最小权限里 | 待确认 |
| 完全正常的两家 | #3092 说有，正文没点名 | 待确认 | 待确认 |

同一篇还写：库里 Meta 连接 7 条，`active` 4 条（其中 1 条其实已死），`error` 3 条。

文档里点过 Facebook 主页或 Meta 令牌的称呼如下。**没有证据把它们对上表里的代号。**

| 文档称呼 | 出处 | 文档里怎么说 | 对上 #3092 哪一行 |
|---|---|---|---|
| CTS | `src/lib/meta-oauth/client.ts`；旧 SOP | 连过 Meta；旧系统用户令牌曾失效，改走库里的主页令牌 | 待确认 |
| Roman | 同上 | 连过 Meta；线索同步曾和另外几家一起断过 | 待确认 |
| Magic Lab Class | 同上；`facebook-reel-adapter.ts` | 连过；共享令牌换不出它的页令牌 | 待确认 |
| NZCPE | 同上；`docs/clients/nzcpe/client-brief.md` | 主页 id 已写入 `clients.facebook_page_id`，挂在它自己的业务管理平台 | 待确认 |
| 30 Kiteroa | `src/lib/meta/token-manager.ts` | 主页已绑，曾因没有页令牌而私信同步为空 | 待确认 |
| Oztop | 旧 SOP | 单独的业务管理平台和主页 | 待确认 |
| NAL | `docs/ledger/2026-09-27-nal-messenger-outage-task-already-sent.md` | 主页绑定没通过核实，私信和表单曾暂停 | 待确认 |

做完后在本 PR 评论里填：每个代号对应的客户称呼（不要写主页号码、广告账户号码、令牌）、分到了哪些任务、有没有因为找不到资产而停。

## 怎么验

用现成的体检，不要新写脚本，不要把令牌当参数传给任何命令。

1. 令牌已进 `META_SYSTEM_USER_TOKEN` 并且服务已按「保存并部署」重启之后，走今日待办那条现成路径：`loadManualItems` → `pushMetaTokenHealthItems` → `probeMetaToken`（`src/lib/pm-todo/meta-token-health-items.ts`）。它只请求 `GET https://graph.facebook.com/v21.0/me?fields=id`。只有 Graph 错误码 190 算死。定时任务名是 `pm-daily-todo`（`src/lib/cron/registry.ts`）。**不要为了试跑去手动触发它**，它会发每日邮件。等它下一轮跑，或打开已经会调用 `loadManualItems` 的今日待办页面。页面上若出现公共钥匙作废、并点名 `META_SYSTEM_USER_TOKEN`，就是没换上。没有这张卡只说明 `/me` 成功，不说明权限齐。
2. 这只体检**故意不查权限**（同文件注释）。OAuth 回调会读 `/me/permissions`（`src/lib/meta-oauth/client.ts`）；评论探针写明系统用户令牌可能读不到这份列表。转化回写里的 `debug_token` 只在真的发送时跑（`src/lib/meta/capi/writer.ts`）。不要为了看权限去发转化、建广告或发帖。系统用户令牌的权限清单是否被存下来：待确认。库里 `platform_oauth_connections.scopes` 是旧的主页授权，不是这把新令牌。
3. 各客户断在闭环哪一环：用同目录 `fb-loop-breakpoints.sql`。只读。Ray 点头之前不要对生产库执行。
4. 不要做旧 SOP 的第三项（建一条暂停广告）。那是在创建广告。
