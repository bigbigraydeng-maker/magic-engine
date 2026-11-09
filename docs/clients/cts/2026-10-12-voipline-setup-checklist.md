# CTS · VoIPLine 门户配置清单（给 PM / CTS / 统筹窗口）

**状态**：ME 这边的接收程序已写好（草稿 PR，未上线）。下面这些只能在 VoIPLine 门户里做。
**规矩**：开发窗口不登录 VoIPLine、不要密码。统筹窗口如用已登录浏览器代做，只照本清单做，做完把「回执」一栏填上。
**官方依据**：[Webhook 文档](https://www.voipline.net.au/knowledge-base/article/8254646129167)（呼入/呼出的开始、接通、结束、录音完成都有对应勾选项；令牌通过 `X-Pbx-Token` 头发给我们；**每次改完要点 PBX 页的红色「应用配置」按钮**）。

## 0. 先要 CTS 给我们的信息（缺一项就停）

| 要什么 | 为什么 | 回执（填） |
|---|---|---|
| VoIPLine 账号是否已开通、是不是 CTS 自己名下 | 数据归 CTS | |
| 号码方案：新西兰还是澳洲号码、新号还是迁入现有号码 | 决定号码格式和来电显示 | |
| 员工人数、每人分机号、每人用话机/Webphone/手机 App | 分机 → 员工邮箱对照表要靠它 | |
| 每个分机对应的员工登录邮箱（ME 里的登录邮箱） | 触点要记「是谁打的」 | |
| 套餐里是否含 Integration/API 许可证、费用 | 官方说集成有许可证，CTS 账号权限未核实 | |
| ~~门户里 webhook 事件的真实样例~~ | **已部分核对（2026-10-12 读 VoIPLine 后台官方示例）**：入站开始/接通/完成、出站完成、入站录音已按官方字段实现；**出站开始、出站接通、出站录音的示例还没读到**，外呼客人号码目前按 `dest_number` 推断，要用真实外呼事件核对 | |

## 0.5 VoIPLine 官方回复里与本方案相关的几点（2026-10-06 邮件，统筹转述，未自行核对）
- **账号归属要以 CTS 门户实际为准**：回复来自 voipline.co.nz 一侧，而本方案引用的 API/Webhook 文档在 voipline.net.au。哪个站点的字段和许可证适用于 CTS，拿到门户后再定。
- **外呼主叫号码必须先经 VoIPLine 验证才能显示**：把「CTS 主叫号码验证」列为外呼验收前置步骤，没验证前外呼显示的号码不是公司号。
- **公平使用政策（接通率 ASR 与呼叫模式）**：员工回访已咨询客户一般没问题，批量连打、冷呼模式容易触线。本方案只记录员工手动通话，不做自动连拨；以后若做点击拨号/批量回访必须限速。
- NZ 号码不支持收发短信；白标/批发价需先签 NDA——这些由 PM 决定，开发窗口不碰。

## 1. ME 这边要先做（开发窗口，等 PM 同意后）

1. PM 回「同意」后，才对生产库应用新增的 4 张表和私有录音桶（迁移文件 `20261012000000_telephony_voipline_ingest.sql`，先预检再应用）。
2. 为 CTS 生成一条「连接」：运行 `npx tsx scripts/telephony-voipline-connect.ts`（会在屏幕上**只显示一次**令牌，库里只存它的哈希），得到 **接收地址** `https://app.magicengine.com.au/api/webhooks/voipline/<连接编号>`。令牌用你们的密码管理器保存，不要贴进聊天或文档。

## 1.5 2026-10-12 实际勘察结果（只读，没改任何设置）
- 在 Chrome 里能登录的是 `au.voipcloud.online` 的账号，账号名 **Dixon Homes**（不是 CTS），预付费、1 个号码、1 个通道；PM 回复「Dixon Homes 就是要用的账号」。
- **Integrations（集成）许可证状态：未开通（Integrations disabled）。** Webhooks 页面明说：没有这个许可证，webhook 端点可以建、触发项可以选，但**不会真的发**。开通许可证是付费项，价格未读，**需 PM 同意后才开通**。
- Webhooks 页面真实字段：见 `src/lib/telephony/voipline/events.ts` 头部注释。要点：`caller_id`=来电号码；`user_number`=员工分机；`conversation_duration`=通话时长（`call_duration` 含响铃）；`connected_at` 为空=没接通；录音事件 `recording_inbound` 带 `call_recording_link`、`recorded_at`，**没有录音编号**。
- 端点表单有：URL、Secret token、Default agent（可选）。令牌需要人在表单里粘贴一次（开发窗口规则不允许往输入框里填令牌）。

## 2. VoIPLine 门户里（Integration/API → Webhooks）

1. 打开 Integration/API 页签 → 左侧 Webhooks。
2. URL 填：ME 接收地址（上面第 1 步得到的）。
3. Secret Token 填：第 1 步的令牌（填进去就是通过 `X-Pbx-Token` 发给我们）。
4. 勾选这八项：User inbound call / answered / completion、User outbound call / answered / completion、Inbound call recording、Outbound call recording。（队列、响铃组、语音信箱摘要本期不收，勾了也只会被留档不处理。）
5. 到 PBX 页签点红色「apply configuration（应用配置）」。**漏这一步 = 配置没生效。**
6. 门户若有「发测试」，发一条；之后到 ME 查「原始事件」是否多了一行（开发窗口来查）。

## 3. 开启录音与员工设置

1. 在员工 / 呼叫流程上开启通话录音（官方支持按员工、会议或呼叫流程配置；云端保存、可经 webhook 提供链接）。
2. 配置分机、公司主叫号码（外呼时客人看到的号码）。
3. **录音告知语音**：呼入流程开头加一句提示（例如「本次通话可能被录音，用于服务质量和培训」）；外呼要在员工话术里先告知，或在呼叫流程里配置对被叫方的提示。**这是合规前提，见 `2026-10-12-voipline-privacy-and-retention.md`。**
4. 应用配置（同上第 5 步）。

## 4. API 出口 IP 白名单（本期不需要，写在这里备查）

本期只用 webhook（VoIPLine 主动推给我们），**不需要**白名单。以后要做「补拉通话历史 / 点击拨号」才调用 VoIPLine API，那时它要求把我们服务器的公网出口 IP 加进白名单。
- 我们部署在 Render。Render 对每个区域有一组**固定的出口 IP**（在 Render 控制台 Connect → Outbound 能看到），所以可以固定，但同区域所有 Render 服务共用这组 IP，不是我们独占。
- 待核实：本服务具体在哪个区域、那组 IP 是什么——**需要 PM / 统筹在 Render 控制台读一次**，开发窗口没有控制台权限，这里不编造数字。
- 注意：VoIPLine 的 API 按人头收费（历史方案估 NZ$4.20/人/月），开通前要 PM 同意。

## 5. 受控测试号码验收（配置做完后）

用 2 个员工分机 + 1 个自己的手机做：①呼入接通 ②呼入没人接 ③外呼接通 ④外呼没人接 ⑤转接一次 ⑥通话里有录音。每一项做完，让开发窗口查三处：原始事件有没有进来、通话行状态对不对、CRM 触点有没有（且只有一条）。**真实通话至今一次都没验过。**
