# 内容工厂 ME 原生化设计 v0.2（子牙综合 · 魏征+板桥 签字 · 诸葛亮 Goal 视角）

> 2026-07-12。PM 拍板:Airtable 未启用可替换,工厂功能终局整合进 Magic Engine 本体。
> 召魏征(架构)+板桥(单人 UX)评审,子牙综合。**本文 supersede 迁移计划 v0.1 §2**
> (不再"对账保住 Airtable",改为 ME 原生 + Airtable 下线)。
> 决策备忘 `2026-07-12-content-factory-storage-decision-v0.1.md` 存储方向不变(Supabase 权威)。

---

## 0. 一句话定调

> **不是重写 Airtable,是把已写好的审核逻辑从「Airtable↔ME 双向同步脚手架」里抽出来,
> 接上 ME 服务端 admin 闸。删掉的兜底代码比新写的 UI 还多,花钱 authz 还更强。Airtable 完全下线。**

## 1. 唯一设计人设(板桥铁律,压倒一切)

> **用户不是「运营团队」,是「一个只想拍板的老板」。凡是"需要他定期维护/整理/录入才能运转"
> 的设计 = 单人运营负分。这套系统替他干活,只在花钱那一下找他拍板。**

**最爽的样子(验收北极星)**:早上端咖啡打开 ME → 首页「今天 2 条等你」→ 点开自动播 →
顺眼点「通过并投放($50)」自动翻下一条 → 不顺眼点一下「不像我品牌」打回 → 一分钟清空;
刷手机看到同行好视频**随手一甩**;生产/素材/爆款记忆全在后台自转。他永远只做「看片+点头/摇头」。

## 2. 界面分层(板桥砍,魏征接)

### 2.1 主界面 = 审核 Inbox(不是 Kanban)

- **冒泡到进门第一眼**:dashboard 顶部角标「今天 N 条等你」+ 审核 Inbox 本体第一屏。(板桥卡壳点①:待审必须撞见,别藏菜单第 5 项。)
- 每条:**大号 `<video>` 自动播**(占屏主体,响应式移动端可竖播)+ **一句人话理由**(为什么给你看这条,模板化非机器报告)+ 主按钮 **`通过并投放(上限 $50)`**(钱数长按钮上,躲不开)+ 次按钮 `打回`。
- **通过**:一步轻确认 modal「这条会开始花钱(上限 $50),确定投?」→ 确定 → **自动翻下一条** → 明确回馈「已投放,明早看效果」。**绝不搞输入 CONFIRM/拖滑块**(那是多人企业防误操作,单人烦死)。
- **打回**:一键理由 chip(`画面质量`/`不像品牌`/`预算节奏`/`不喜欢`)点一下即打回,想补充再补充,**不强制写作文**(强制=嫌烦=不打回=系统学不到)。对齐现有 `reject_category`。

### 2.2 次界面 = 工单 Kanban(已存在,降级为"偶尔翻历史")

- `/dashboard/factory/page.tsx` **已建好**(按状态分组 + dead_letter 复活)。不删,降级:首页只显示一行「后台在做 2 条·已投放 5 条」,点开才进 Kanban。(板桥:独立看板单人不天天看;魏征:已建别浪费。)
- **魏征必补**:工单页加 **worker 心跳指示**(读 `content_work_orders.heartbeat_at` 最新值,显示"worker 最后心跳 X 分钟前")。否则 worker 挂了 UI 一片"生产中"假象,人不知道。

### 2.3 隐形/自动(板桥狠砍,不做成维护表)

- **赢家结构库 = 系统隐形记忆**:投得好的结构系统自动多用(表现回流),**不做成用户要维护的表**。他不打开、不标注。护城河在"系统自己记",不在"他填表"。
- **clip 素材库 = 后台仓库**:系统自用,他不管理。唯一人工入口=喂素材(见 §3)。MVP 只做只读浏览/播放"瞄一眼仓库",不必天天看。

## 3. 两个零摩擦输入(板桥"随手一甩",子牙裁 LLM 预填)

### 3.1 客户实拍/图片 → "把素材甩进来"

- 一个上传口,系统自己分门别类入 `video_clips`。MVP:走 §迁移 S1 的 `ingest-clip.mjs` 脚本
  + worker 进 bucket;**浏览器端大文件直传(魏征暗坑④)推迟到 P3**,不 block。

### 3.2 学同行视频 → "甩个链接"(胜负手)

- **捕获零摩擦**(板桥):ME 里一个常驻「看到好视频?贴这」输入框 + 理想加 **WhatsApp/Telegram 投喂 bot**(手机刷到→原生分享/转发给 bot→收下)。捕获=只存 URL 进 peer_study 队列,**不要求他描述喜欢哪里**。
- **结构录入 = LLM 预填草稿 + 几下点选修正**(子牙裁两人张力):不是空白表单(板桥反对),也不是全自动拆解(魏征说 ROI 负)。你有空时批量过队列,每条 LLM 先给 hook/middle/cta + 赢因草稿,你点几下改对即可 → 入 `winner_structures`,`entry_channel='peer_study'`,`source_meta` 存参考 URL。
- **🔴 版权红线(魏征,代码层保证)**:**只存结构描述 + URL 引用,绝不下载/入库同行视频文件**。受著作权保护的是表达不是思想,存"抽象结构"安全,拉 mp4 进 bucket 就炸。winner intake 的 clip 引用**只能指向自家 bucket 前缀**(照 `complete/route.ts` 校验范式加一条)。strategist 装配永远用自家 `video_clips`,winner 只提供骨架顺序。

## 4. 花钱 authz(魏征:ME 版更强不更弱)

| 闸 | Airtable 版 | ME 原生版 | 强弱 |
|---|---|---|---|
| 谁能点 | base 协作者白名单(ME 管不到) | **`guardAdmin()`**(whitelist role=admin,ME 单一事实源) | **更强**,离职即失权 |
| 认签名 | `FACTORY_REVIEWER_EMAILS` sweeper **事后**校验 | `requireSession` **点击前** 403 | **更强**,闸提前 |
| $50 硬顶 | review-sync 校验 | **审核 route handler 服务端**重读 `budget_cap`+查 `factory_balance_ledger` balance 判 $50(照抄 `complete/route.ts`"唯一可信边界"范式) | 同,不动 |
| 留痕 | Airtable last-modified-by | `review_ref.approved_by = session.user.email` | 同 |

**🔴 魏征红线③**:UI 的 confirm modal 只是体验,**真闸必须在 route handler**,绝不能"UI confirm 过了就在 route 省服务端校验"(架构旁路,狄仁杰会一刀断在这)。

## 5. Airtable 下线 + sweeper 生死(魏征,别一刀切)

- **删**:`review-sync.ts`(425 行)+ `factory-review-sweeper` cron + `.github/workflows/factory-sweepers.yml` 里 review 那条 + 全部 Airtable env(`AIRTABLE_API_KEY`/4 个 base·table id/`FACTORY_REVIEWER_EMAILS`)+ 列名同步契约。审核走 ME 同步请求-响应,双向同步的幂等/竞态兜底代码全删得掉。
- **🔴 留**:`factory-worker-sweeper`(收僵死 claimed/producing 超时工单→重排)。**这跟 Airtable 无关**,是本地单机 worker 不可靠性的兜底,ME 原生化后照跑。**最易犯的错=把两个 sweeper 都当脚手架删了。**
- **ME Factory Ops base + CTS base 镜像表**:ME 原生上线后一并归档/删(迁移计划 S4,PM 显式 go)。

## 6. 复用清单(魏征清算:总新建 = 3 组 API + 审核 Inbox + 少量页)

| 要做的 | 复用现成 | 新建 |
|---|---|---|
| 审核 Inbox + 抽屉(video 预览+通过/打回+确认) | **`ContentStudioDrawer.tsx`/`ReelsStudio.tsx`**(ME 已有 `<video>` 预览+抽屉骨架);`review-sync.ts` 的 `applyApprove/applyQualityReject/applyBudgetUpdate` **纯逻辑原样搬**成 route | `POST /api/factory/work-orders/[id]/review`(action=approve/reject_quality/reject_budget,`guardAdmin`+服务端花钱闸) |
| 工单 Kanban + worker 心跳 | **`/dashboard/factory/page.tsx` 已建** | 心跳指示 + 挂审核入口 |
| winner 录入(含 peer_study) | **`CompetitorDomainsPanel`/`PrimaryKeywordsPanel` chip 模板**(赢因标签=chip) | `GET/POST /api/factory/winners` + peer_study 队列/LLM 预填 |
| clip 库浏览(只读) | ReelsStudio 媒体网格 | `GET /api/factory/clips` |
| clip 浏览器直传 | worker `claim` 的签名上传逻辑抽共享 lib | `POST 签名上传端点`(P3,唯一"看着简单实则要认真做") |

**枚举扩展老坑(魏征⑤)**:加 `entry_channel='peer_study'` / 新 status 必 grep 全仓
`Record`/`switch`/`STATUS_META`/`ORDER` 同步 fallback(CLAUDE.md 硬约束 + superseded 事故)。

## 7. 诸葛亮 Goal 视角(子牙代述)

内容工厂是 DAPE 的 **E(Execution)** 臂,服务**社媒 + 广告**两支柱;"学同行结构"这条正是
**竞品支柱**信号喂进执行(6 支柱 × DAPE 矩阵落一格)。整条=飞轮的内容生成闭环,契合 ME
"以 Goal 为中心的生意指挥平台"定位——老板只在 Prescription 出的处方要花钱执行那一下拍板。

## 8. 分期(魏征 P1-3 × 板桥优先级)

| 期 | 范围 | 估 | 产出 |
|---|---|---|---|
| **P1 核心闭环** | 审核 Inbox(首页角标+自动播+通过/打回一键理由)+ `POST /review` route(`guardAdmin`+服务端 $50 闸,搬 review-sync 三 apply)+ 工单页 worker 心跳 → **Airtable review-sweeper 下线** | ~1.5 天 | 审核走 ME,单人闭环跑通 |
| **P2** | 学同行"甩链接"捕获 + LLM 预填结构录入(`peer_study`)+ 赢家自动记忆(表现回流)+ clip 库只读浏览 | ~1 天 | 素材/学习入口 |
| **P3 按需** | clip 浏览器直传 + WhatsApp/Telegram 投喂 bot;之前实拍继续走 ingest 脚本/worker 不 block | 按需 | 零摩擦上量 |

**前置**:存储迁移 S1(素材灌进 Supabase + worker 改指 MagicLab_Studio 引擎)可与 P1 并行,
互不依赖。

## 9. 待 PM 拍板一件

> **ME 原生化 + Airtable 完全下线 + 分期 P1→P3 —— go?**
> go 后先动 P1(审核闭环)+ 迁移 S1(素材入库),两者并行。删 Airtable 镜像表(S4)做到再单独授权。

---

关联:[[project-content-factory-ads-loop]] · 决策备忘/迁移计划 v0.1 · 主 spec 2026-07-11-content-factory-ads-loop-v0.1
