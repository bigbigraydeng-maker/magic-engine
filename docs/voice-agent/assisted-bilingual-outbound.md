# Assisted Bilingual Outbound — 助攻式双语外呼 (spec v0.1)

> Phase 2 功能。三审梳理：子牙(架构+延迟+KB) · 魏征(风险) · 板桥(操作员/客户体验) · PM 拍板 2026-07-16。
> **前置**：基础全自动通话跑通 + Render 付款恢复 + 真 OpenAI key + NZ 主叫号。

## 1. 定位

**真人当「大脑 + 母语」，AI 当「嘴 + 翻译 + 资料库」。** 电话上只有 AI ↔ 被叫客户一条腿；
服务商(操作员)坐 ME 后台 **driving**，全程**纯语音**掌控，客户听到的是流畅的、他母语的 AI 语音。

- **DAPE**：E(执行) · **6 支柱**：销售触达 / 口碑 · **轨**：FDE(要真人操作员坐镇，非 self-serve)
- **黄金用例**：Roman(华人四语中介)带华人买家谈英文开发商 / 英文有限的华人老板谈价格条款
  —— **用中文脑子做主、外面听到流利英文，补短板放长板**。
- **跟全自动外呼切开**：全自动 = 量大、低风险、脚本化(确认预约/群发跟进)；助攻 = 高价值、
  代表老板本人、要临场判断。

## 2. 端到端流程(纯语音版)

```
1. ME 后台点「呼叫客户」 → 外呼(复用 placeOutboundCall + 合规 gate)
2. 客户手机响，来电显示 = 服务商的 NZ 号(主叫 ID；PM 采购)
3. 客户接通 → 全程只听到 OpenAI Realtime AI 语音
4. 后台屏幕：实时双语字幕
   - 客户说的(英文) → 翻成操作员母语(中文)显示
   - 操作员说的(中文，STT) → 显示 + 发出的英文
5. 操作员对电脑说中文 → STT 转文字 → (按模式)翻译/KB增强 → 注入 SIP 会话 → AI 逐字朗读给客户
6. 操作员全程语音掌控；仅数字/价格类需扫一眼确认(见 §6)
```

**技术真相**：操作员语音**不**直接进那条 SIP OpenAI 会话(该会话音频输入是客户电话腿)。实际是
`操作员语音 → STT → 文本 → response.create 让 SIP 会话的模型逐字朗读译文`。STT 是唯一精度风险点(§6)。

## 3. 两种模式(ME 后台一个开关，可整通设 / 中途切)

| 模式 | 行为 | KB | 延迟(机器) | 安全 |
|---|---|---|---|---|
| **纯人工输出** | AI 只忠实翻译操作员说的话 | ❌ | ~0.3–0.7s | 每句操作员负责 |
| **AI Mix 混合** | 操作员给中文意图 → AI 查 KB 拿事实 + 合成英文答复 | ✅ | ~1.5–3s | **价格/库存/承诺 → 确认才发** |

- Mix 模式下，价格/日期/名额/「保证·免费·退款」类 → **强制操作员确认才朗读**(§6/§7)。
- KB 走**旁路 Responses API 编排**(复用 `searchKnowledge()` 逻辑)，**不**走自主 realtime function
  路径；`requires_human_verification=true`(命中 `PRICE_RE`)时必须弹操作员确认。

## 4. 延迟(数字)

| 方向 | 机器延迟 |
|---|---|
| 客户英文 → 后台中文显示 | ≈ 1.1–2.1s |
| 操作员中文语音 → 客户听到英文 | 纯翻译 ≈ 0.7–1.5s / KB 增强 ≈ 1.5–3s |

**机器不慢；大头是人(读+想+说)** → 被叫客户每轮 **≈ 5–12s 应答间隔**(dead air 是范式物理特性)。
**三件套压下去**(缺一即残次品)：
1. **AI 自动垫场**：客户话音一落，AI 立即说 "Sure, let me check that for you…" 填静音
2. **纯语音输入**(已定，去掉打字，操作员侧 3–8s → 1–2s)
3. **快捷话术**(常见应答一键触发)

## 5. 架构：复用 vs 新建

**✅ 直接复用**(不重造)：SIP 原生外呼 + 合规 gate(`placeOutboundCall`/`outbound-gate.ts`)、
OpenAI SIP 控制面(accept/refer/hangup)、ws 桥 + 事件归一化(`openai-bridge.ts`)、CallSession 状态机 +
转写落库、知识库检索 + vector store 隔离、落库/租户/审计/lead、SSE 流式 pattern(抄
`api/clients/[id]/prescription/*` 的 `ReadableStream`)。

**🔨 新建**(工作量所在)：
1. **浏览器 ↔ 通话 实时通道**：下行 **SSE** `GET /api/voice/calls/[callId]/live`(推双语字幕/状态)；
   上行 **POST** `/api/voice/calls/[callId]/operator-turn`(STT 文本 + mode)。进程内按 `callId → bridge`
   寻址 —— **绑定单 persistent 实例**；多副本/独立 worker 模式要走 `REALTIME_WORKER_URL` 内部转发。
2. **操作员编排层**：STT 文本 → (translate | kb_assisted) → `bridge.injectOperatorSpeech(英文)`。
3. **助攻操作台 UI**：见 §8。
4. **bridge 改造**：`injectOperatorSpeech(text)`(泛化现有 `greetingInstruction` 的 verbatim 技巧)、
   `speakFiller(text)`、**assisted 哑巴模式**(压住模型自主应答，闭嘴等操作员)。

## 6. STT 数字防错(纯语音的代价)

纯语音去掉了「打字+发送前确认」的天然刹车。补偿：
- 屏幕**实时回显**操作员被转成的文字 + 发出的英文 → 操作员扫一眼可**口头改正**("不对，是两百八")。
- **数字 / 金额 / 日期 高亮 + 一键确认**：命中即拦，操作员点头才朗读("八千"听成"八万"的灾难在此拦下)。
- 涉钱涉数的关键轮次，建议切 Mix 模式走确认闸。

## 7. 上线前必过的关(团队一致)

| 关 | 提出 | 说明 |
|---|---|---|
| **🔴 技术命门 spike(先 1 天)** | 子牙 | 真 key + 真号验证：Realtime 能否「哑巴模式 + 逐字朗读不擅自发挥」。**压不住则范式要改**(降级 TTS 音频注入成本高，因无媒体桥)。**必须最先验。** |
| **🔴 AI 越权承诺(法律)** | 魏征 | 关键话**回译给操作员看 + 确认才发** + **出口侧英文敏感词拦截**(价格/保证/日期) + **kill switch 静音键 <200ms** |
| **🔴 跨租户实时劫持** | 魏征 | 通道握手强制校 `操作员租户 = 通话租户 = call 租户`(校验放桥接层入口，非靠前端)；一次性短时 token 绑 (operatorId, callId)；同一通只允许一个 driver；实施后**狄仁杰攻击验证** |
| **🔴 合规(AU/NZ)** | 魏征 | 开头强制播「AI 辅助翻译 + 真人助理 + 正在录音」(按州/国脚本)；外呼前 DNC 检查；录音加密+保留期+删除通道。**必须过法务，不是子牙拍**，先按最严州做 |
| **🟠 in-process 单实例** | 魏征 | 重部署/多副本会断桥。MVP 绑单实例 + 部署避开营业时段 + UI 明示；中期抽独立 worker / sticky session |
| **🟠 操作员掉线的履约真空** | 魏征 | 操作员通道断 → AI **立即进「稍后回电」脚本或礼貌挂断**，**绝不让无人 driving 的 AI 单独跟客户谈业务** |
| **🟠 轮次管理** | 魏征/板桥 | 客户 speaking 时 AI 输出排队不打断；操作员超时 AI 播填充语维持在线感；UI 显示「客户正在说/已停顿」 |

## 8. 助攻操作台 UI(纯语音版，极简)

操作员只**说话 + 偶尔点一下**。屏幕三块：
1. **大字双语字幕**(客户说的 / 你说的 / AI 发出的英文，实时滚动)
2. **模式开关**(纯人工 ↔ AI Mix) + **数字·价格高亮 + 一键确认**(唯一常点处)
3. **静音 / 挂断 / 让 AI 稍等垫场** 按钮(kill switch 优先级最高)
- Mix 模式下 KB 命中时弹**资料卡**(来源 doc + confidence + 是否需核价)，操作员审阅后一键朗读。

## 9. 验收指标(板桥)

- **唯一硬指标**：被叫客户侧**冷场秒数**。陪 Roman 手把手跑 **3–5 通**真实电话，冷场可控 + 操作员不手忙脚乱 = 过。
- 不拿功能数量当进度。MVP 只保三件：大字翻译 + 一键建议 + 自动垫场。

## 10. 工作量 + 分期

- **档位：L ≈ 3–4 周/人**到内部可用 demo。
- **顺序(降风险)**：① 1 天真机 spike(§7 第 1 关)→ ② 浏览器 SSE 下行 + POST 上行(3–4d)→
  ③ operator 编排层 + KB 旁路(3–4d)→ ④ bridge 注入/哑巴模式(4–6d 含试错)→ ⑤ 操作台 UI(4–5d)→
  ⑥ 填充语/语音输入/快捷话术打磨(2–3d)。
- **前置依赖**：基础全自动通话跑通 · Render 付款恢复 · 真 OpenAI key · NZ 主叫号(PM 采购)。

## 11. 关键文件(main 上，起分支时从这些接)

- `src/lib/voice/realtime/openai-bridge.ts` — ws 桥 / `greetingInstruction`(verbatim 范本) / `buildResponseCreateFrame`
- `src/lib/voice/realtime/session.ts` — CallSession 状态机 + 转写落库
- `src/lib/voice/realtime/worker.ts` — `placeOutboundCall`(复用)
- `src/lib/voice/knowledge/index.ts` — `searchKnowledge` + 价格红线 `PRICE_RE`
- `src/lib/voice/providers/openai.ts` — SIP accept(`server_vad`)/refer/hangup
- `src/app/api/voice/webhooks/openai/route.ts` — in-process `startRealtimeSession` + `REALTIME_WORKER_URL` 多副本钩子
- `src/app/api/clients/[id]/prescription/generate/route.ts` — 现成 SSE `ReadableStream` pattern(抄它做下行)
