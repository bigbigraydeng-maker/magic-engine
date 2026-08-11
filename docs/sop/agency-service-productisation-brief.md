# 中介服务产品化 · 新窗口交接 brief

> 建立于 2026-07-30 · 由 30 Kiteroa 实盘窗口交接
> **本窗口的任务**：把「给中介做楼盘 lead-gen」从一次性项目变成可复制销售的产品
> **不负责**：30 Kiteroa 的日常投放监控（那在另一个窗口，别去动它的广告）

---

## 0. 开工前必做（顺序不能乱）

```bash
git fetch origin
git merge origin/main        # 永远 merge，本仓禁止 rebase / force push
npm run build                # merge 完必须重跑，文本不冲突 ≠ 语义不冲突
```

**读完本文再动手**，另外必读 `docs/clients/30-kiteroa-rothesay-bay/campaigns/live-ops-handoff.md`
（§6.5 定向修正 / §6.6 中文片 / §6.7 数据飞轮盘点 + 教训 12–18）。

---

## 1. 我们手上真实有什么（可以拿去卖的）

### 1.1 实盘数据 —— 30 Kiteroa（**唯一真实案例，别夸大**）

| 项 | 值 | 口径 |
|---|---|---|
| 花费 | NZ$105.75 | 2026-07-27 起 4 天 |
| 触达 / 展示 | 2,103 / 4,093 | |
| CTR | **5.20%**（FB 单独 5.75%）| 房产广告常见 1–2% |
| 咨询数 | **6** | Messaging conversations started |
| 单个咨询成本 | **NZ$17.63** | |
| **看房 / 出价 / 成交** | **未知** | 🔴 承接在中介手上，尚未回流 |

> 🔴 **红线**：目前**没有任何成交数据**。对外只能承诺「咨询量与成本」，
> 绝不能承诺「保证成交 / 保证几组看房 / 保证多少华人客户」（华人咨询实测仍是 0，正在验证）。
> 数字一律以本表或数据库实读为准，**不许估算、不许四舍五入成更好看的数**。

**完整案例预计 2026-08-26 前后成型**（$1,300 跑完，30 天，预估 50–95 个咨询）。
**拿完整案例谈价才站得稳** —— 但「诊断」不需要等，见 §2。

### 1.2 跨客户经验库（差异化核心）

表 `global_learned_lessons`（Supabase `glbdnayojixmexgofbsd`），首批 6 条，
已通过 PR #689 接进 agent prompt —— **下一个地产客户开工时 AI 自动读到**。

| lesson_key | 层 | 置信 |
|---|---|---|
| `re-ads-do-not-restrict-to-home-location` | 行业·地产 | 0.70 |
| `re-ads-instagram-underperforms-premium-housing` | 行业·地产 | 0.60 |
| `meta-ai-copy-rewrite-strips-compliance-qualifiers` | 渠道 | 0.95 |
| `meta-messenger-creative-needs-app-destination` | 渠道 | 1.00 |
| `config-must-go-through-ui-not-direct-db-write` | 全局 | 0.90 |
| `video-source-metadata-must-be-verified-by-frame` | 渠道 | 0.85 |

**这是「别的代运营每个客户从零开始，我们不会」这句话的实物支撑。**

### 1.3 内容生产能力（已验证）

用客户手机随手拍的素材 → 16 秒竖屏中文成片，约 1.5 小时（含选帧、烧字、配乐、合规校对）。
可复用脚本：Dropbox `Magic Engine/by-client/05_Kiteroa/_tooling/{make_text.py,render_cn.sh}`
配乐来源：`MagicLab_Studio/_shared/music/`（现成 Suno 曲库，不新生成）

---

## 2. 销售框架（30 Kiteroa 窗口 2026-07-30 拟，未经 PM 拍板）

### 2.1 开场：不介绍自己，当场指出他在漏钱

> 「让我看你广告后台 30 秒，我告诉你三个正在漏钱的地方。」

现场查三样，**至少中一样几乎是必然**：
1. 投放范围是否只圈了楼盘周边
2. 是否只投「居住在此」的人（Meta 默认值 `location_types=['home']`，多数人不知道要改）
3. Instagram 花了多少、出了几个咨询

**依据**：30 Kiteroa 自己就同时踩中前两条，第三条实测 IG 花 $14.74 / 0 咨询 / CTR 只有 FB 的 1/4。

### 2.2 产品三层（**先卖中间那层**）

| | 卖什么 | 参考价 | 证据强度 |
|---|---|---|---|
| 入门 | 投放诊断 + 问题清单 | 免费 / ~$200 | ✅ 已做过一次 |
| **主力** | **单盘 lead-gen 包**（内容 + 投放 + 周报）| **~$2,000**（30 Kiteroa 锚点）| ✅ 4 天真实数据 |
| 续约 | 中介私域月费（养池 + 每月出片）| **待 PM 定** | ⚠️ 未跑过 |

单盘制的好处：中介**赌一个楼盘，不是赌一段关系**，决策门槛低。

### 2.3 三条差异化（都要有实物支撑，不许空喊）

1. **带着别人交过的学费进场** → §1.2 经验库
2. **资产归中介，白纸黑字** → spec `docs/superpowers/specs/2026-07-28-audience-asset-engine.md` §7.1（PM 已拍板的红线）
3. **我们出内容，不是只投钱** → §1.3

---

## 3. 硬约束（违反即事故）

1. **绝不凭空注入客户业务数据** —— 写任何客户的方向/关键词/数字前，必查 `master_briefs` + `clients.primary_keywords`；对外内容必先 WebFetch 客户官网真实产品页
2. **客户营销落地页必须建在客户自己域名** —— 绝不建在 magicengine.com.au 子路径（PM 定的永久红线）
3. **配置类字段一律走后台 UI** —— 直接写库会绕过校验，30 Kiteroa 因此丢了 4 天数据（教训 18）
4. **不可逆操作需 PM 显式 go** —— merge / apply_migration / 删分支 / 对外发送
5. **不要碰 30 Kiteroa 的在投广告** —— 那是另一个窗口的活

---

## 4. 待 PM 拍板（本窗口应推进，但不能替他决定）

| # | 议题 | 备注 |
|---|---|---|
| 1 | 中介私域月费怎么定价 | 档案 §7 第 10 条，一直挂着 |
| 2 | 四层战略谁出钱 | 子牙结论：第 1 层用开发商预算，第 2/3/4 层作为月费产品卖给中介 |
| 3 | 开发商合同的数据条款 | 已提两次未写，受众资产归属 |
| 4 | 下一单从哪来 | **建议从 Roman 手上其他盘走** —— 他已见过我们干活，且他本身是渠道 |

---

## 5. 相关位置速查

| 要找什么 | 在哪 |
|---|---|
| 数据库（唯一权威源）| Supabase `glbdnayojixmexgofbsd` |
| 30 Kiteroa 全部实况 | `docs/clients/30-kiteroa-rothesay-bay/campaigns/live-ops-handoff.md` |
| 受众资产 spec（归属红线）| `docs/superpowers/specs/2026-07-28-audience-asset-engine.md` |
| 跨客户经验库接入代码 | PR #689，`src/lib/memory/{types,service,format}.ts` |
| 客户素材 / 成片 / 出片脚本 | Dropbox `Magic Engine/by-client/` |
| Type A vs Type B 客户模型 | 见 memory `project-me-client-type-a-vs-b` |

---

## 6. 建议的第一步

**不要一上来写销售材料。** 先做这两件，因为它们决定材料里能写什么：

1. **把 §2.1 的「30 秒诊断」做成可执行清单** —— 固定查哪几项、每项怎么判定、话术怎么说。
   这是唯一不依赖完整案例、现在就能用的东西。
2. **确认 Roman 手上还有没有别的盘**（需 PM 提供）—— 若有，下一单从他走最短。

案例材料等 8 月底数据完整再写，那时数字才站得住。
