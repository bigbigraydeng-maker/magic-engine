# 内容工厂素材存储 — 决策备忘 + spec v0.1

> 2026-07-12 起草（子牙）。触发:P21.J M2 首条真实成片跑通后,PM 问「今后素材管理走
> Supabase / Dropbox / 混用?」+「还是不清楚怎么存」。本文上半 = 给 PM 拍板的决策备忘
> (大白话),下半 = 落地 spec。**存储方向属工作流决策,需 PM 拍板;技术实现子牙定。**

---

# 上半 · 决策备忘（PM 读这一半就够）

## 一句话结论

> **素材只有一个「家」= Supabase。Dropbox 不是家,是你手工干活的「工作台」。**

今天的乱,是因为**不小心搞出了两个家**:手工剪的片存 Dropbox,工厂生成的片存 Supabase,
两边互相看不见。这不是谁选错了,是历史长出来的。要治,就是**认定一个家**。

## 记住这个画面:「一个仓库,两道门」

```
                    ┌─────────────────────────────┐
                    │   素材仓库(唯一权威)         │
                    │   = Supabase                │
                    │   · 所有可复用 clip          │
                    │   · winner 赢家段落库        │
                    │   · 工厂出的成片             │
                    └──────┬───────────────┬──────┘
                           │               │
                    人这道门           机器人这道门
                           │               │
              ┌────────────┴───┐    ┌──────┴──────────┐
              │ 你的 Dropbox    │    │ 工厂 worker      │
              │ 工作室(手工剪) │    │ (无人值守)       │
              │ 剪好的keeper    │    │ 读库→做变体→    │
              │ →推进仓库 ↑     │    │ 出片→推回仓库 ↑ │
              └────────────────┘    └─────────────────┘
```

- **仓库**(所有能复用的 clip + 赢家段落 + 成片)只有**一个地方:Supabase**。这是唯一的真相源。
- 你通过**两道门**碰它:
  - **人这道门** = 你的 Dropbox 工作室。你在 Finder 里拖、剪、手工渲。**剪出来的好素材,推进仓库**。
  - **机器人这道门** = 工厂 worker。读仓库→做广告变体→出片推回仓库。
- **Dropbox 是一道门,不是仓库本身**。今天 Dropbox 不小心当了「第二个仓库」——这就是那个 bug。

## 为什么是 Supabase 当仓库,不是 Dropbox

| 理由 | 说明 |
|---|---|
| **工厂本来就读 Supabase** | worker、Airtable 卡、ME 后台全走 Supabase。素材放这儿,工厂直接能挑。 |
| **安全** | 无人值守的机器人不能揣一把 Dropbox 长效钥匙(=红线)。Supabase 用一次性签名链接,出事只影响一条。 |
| **成片要能直接播** | Airtable 卡、Publer 发布都要一个「公开能打开的链接」。Supabase 天生有;Dropbox 要折腾 rlkey(你血泪 4 次那个坑)。 |
| **飞轮才转得起来** | 一个仓库=手工拆的赢家段落能喂工厂做变体,工厂生成的 clip 也回流。两个仓库=素材碎成两半,工厂没料挑(你刚看到的"素材选取糙"就是这根因)。 |

**为什么不纯 Dropbox**:无人值守放长效 token = 红线,且公开链接坑多。
**为什么不永久混用**:素材库碎成两半 = 工厂立身之本(统一素材库)塌了。

## 你只需要拍一个板

> **「素材仓库认 Supabase,Dropbox 降级成工作台」—— go / 不 go?**

`go` 之后,后面「什么进 Supabase、什么留 Dropbox、怎么搬」全是子牙的技术活,不再上抛你。

## 不搞大爆炸,分三步走(你不用一次全迁)

- **第 1 步(马上)**:工厂需要的东西先进 Supabase——把你 Dropbox 里现成的真实 clip
  (CTS 15 条 i2v + Oztop 12 条 i2v_out)灌进素材库。工厂立刻有料挑。**你手工工作流一点不动。**
- **第 2 步(过渡)**:手工剪出的 keeper clip,加一步「推进 Supabase」(一个小同步,单向)。
- **第 3 步(以后)**:手工成片也改存 Supabase 公开链接 → 退役 Dropbox rlkey + Make 监听那套麻烦。**这步动你的习惯,单独再议,不急。**

---

# 下半 · 落地 spec（子牙实现用）

## 1. 存储分层:什么进 Supabase,什么留本地/Dropbox

| 资产类型 | 存哪 | bucket 路径 / 表 | 理由 |
|---|---|---|---|
| **可复用 clip 库**(A 轨实拍 + B 轨生成) | **Supabase** | `content-factory/clips/{a-real\|b-generated}/{client}/` + `video_clips` 表 | 工厂读它,两管线共享的唯一库 |
| **Winner 赢家段落库** | **Supabase** | `winner_structures` 表(段落描述) | strategist 拿它做骨架 |
| **工厂成片(自动)** | **Supabase** | `content-factory/renders/{client}/{wo}/` | 已落地(M2) |
| **品牌套件**(logo/music/watermark/字体/voice) | **本地(v1)→ Supabase(worker 上云时)** | `content-factory/brandkit/{client}/` | v1 单机 worker 读本地磁盘够用;上 Render 前必须搬进 bucket |
| **手工工作室草稿 / project json / 中间件** | **Dropbox / 本地** | `MagicLab_Studio/{client}/projects,footage,archive` | 人的工作台,Make 监听,scratchpad 会清空 |
| **手工成片(交付物)** | **过渡期 Dropbox → 第 3 步迁 Supabase** | — | 现有 Make→Airtable→Publer 链路依赖 Dropbox,分步退役 |

**权威源规则**:凡是**工厂要 reason 的东西**(clip 库 / winner 库 / 成片)——Supabase 是唯一真相源,
Dropbox 里同名文件只是「人在编辑的副本」,不作数。

## 2. 单向同步桥(Dropbox 工作室 → Supabase 素材库)

- **方向永远单向**:Dropbox studio 产出的 keeper clip → 灌进 `video_clips` + bucket。工厂**从不**写回 Dropbox。
- **实现**:一个 ingest 脚本(`scripts/factory-worker/ingest-clip.mjs` 或复用 studio 引擎侧钩子):
  输入本地/Dropbox clip 文件 + 元数据(client / scene_tag / track / motion_type)→ 上传 bucket
  `clips/{track}/{client}/` → INSERT `video_clips`(status='active')。
- **幂等**:按 `source_meta.origin`(如 `MagicLab_Studio/CTS/.../foo.mp4`)去重,重跑不重插。
- **未来**:Make 场景可加一支「Dropbox 新 keeper → 调 ME ingest endpoint」,但 v1 手动跑脚本即可。

## 3. 两个立即待办(本次对话暴露的真 bug)

### 3.1 worker 指错引擎 —— 改指 MagicLab_Studio 权威引擎

- **现状**:`worker.mjs` 的 `MAKE_PROMO` 默认 `~/Documents/CTS_BrandKit/make_promo.py`(**初版**)。
- **问题**:权威引擎已搬 `~/Dropbox/MagicLab_Studio/engine/make_promo.py`,新版才有
  `music_mood` 自动选曲 / looks 调色 / Ken Burns 运镜(`motion`)/ CJK 字体 / **素材真实视频
  自动匹配(basename)** / `-stream_loop -1` 配乐铺满。**PM 看到的「没音乐 + 素材糙」一半根因在此。**
- **修法**:worker 默认 `MAKE_PROMO_PATH` 指向 `$STUDIO_ROOT/engine/make_promo.py`;
  `BRAND_KIT_PATH` 指 `$STUDIO_ROOT/{client}/brandkit`;新版 config 字段(`music_mood`/`look`/
  `motion`/`caption_mode`)由 worker 的 `assemble()` 生成时带上。`FACTORY_BGM_PATH` 兜底保留。
- **依赖**:worker 机器需能读 `$STUDIO_ROOT`(Dropbox 本地同步目录);单机 Mac v1 天然满足。

### 3.2 素材库灌种子 —— 工厂才有料挑

- 把 Dropbox 现成真实素材灌进 `video_clips`:
  - CTS:`~/Dropbox/CTS/reels-clips/`(15 条 3s 多样运镜 i2v)+ `cts reels/`(本次已 seed 3 条)
  - Oztop:`Oztop/library/i2v_out/`(12 条真实动态:install/kitchen/clean/bath 等)
- 每条打 `scene_tag`(great_wall / guilin / kitchen_install / mopping…)+ `track`(实拍 a_real /
  生成 b_generated)+ `motion_type`,走 §2 ingest 脚本。
- 灌完 strategist 的「scene_tag×角度 token 重叠优先 + 冷素材优先防疲劳」才真正生效
  (今天库空=只能全用,就是"素材选取糙"的现象层)。

## 4. 与既有两轨纪律的对齐(不重造)

P21.J 的 `a_real` / `b_generated` = PM 2026-07-08 拍板的 **A 轨真实图片运镜(免费)/ B 轨
muapi 文生视频(付费)** 一一对应(见 [[project-social-video-i2v-muapi]])。存储分层不改这条:
- A 轨实拍 clip → `clips/a-real/`,B 轨生成 clip → `clips/b-generated/`(路径即物理隔离,
  complete 校验前缀,护栏 6 B 轨白名单已在)。
- 生成式 I2V「会重画」的必幻觉教训(兵马俑/东方明珠翻车)照旧:landmark 优先实拍进库,
  生成只在「有机场景+能接受艺术化」或客户显式放开(CTS `allow_b_track_landmark_ads`)时用。

## 5. OpenMontage 的定位(澄清,不迁移)

- **OpenMontage = agent 驱动 pipeline**(LLM 逐 stage 陪跑)= 手工高精度一次性创意片。**工厂不用它。**
- **make_promo.py = headless 装配器** = 两边**共用的引擎**。工厂 worker 调它。
- 关系:**工厂 = 手工工作室同一台车 + 自动驾驶(无人值守外壳)+ 决策大脑(strategist)**。
  发动机(make_promo)、油品分类(A/B 两轨)、素材(muapi/实拍)全共享,方向盘换成信号触发。
- 详见 [[project-video-brandkit-pipeline]]。

## 6. 分期

| 阶段 | 范围 | 依赖 PM |
|---|---|---|
| **S1(马上)** | §3.2 灌种子 + §3.1 worker 改指 MagicLab_Studio 引擎 | 拍板存储方向 go |
| **S2(过渡)** | §2 单向同步桥 ingest 脚本;keeper clip 手动灌库 | — |
| **S3(以后)** | 手工成片迁 Supabase 公开链接,退役 Dropbox rlkey + Make 监听;brandkit 进 bucket(worker 上云前置) | PM 定何时动手工发布链路 |

## 7. 待 PM 拍板的唯一一件

> **§ 上半末尾:「素材仓库认 Supabase,Dropbox 降级工作台」go / 不 go。**
> go 之后 S1 立即动;S3 动手工发布习惯时再单独确认。

---

**关联**:[[project-video-brandkit-pipeline]] · [[project-social-video-i2v-muapi]] ·
[[project-content-factory-ads-loop]] · 主 spec `docs/superpowers/specs/2026-07-11-content-factory-ads-loop-v0.1.md`
