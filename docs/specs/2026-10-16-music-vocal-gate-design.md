# 出片机「音乐含人声就拦」检查 · 一页设计（草稿，待子牙 + 魏征审；禁 Codex 审）

> 106 号 · 2026-10-16 · 风险级 **B**（出片机的一道只读检查，不新增能力线，不改已有模板输出，不写客户数据）。DeepSeek 写。
> 起因：Tale 三条 (ccff4bb9/abd7a705/19c191c5) 的背景音乐 `analytical-scholar` 自带地产广告人声（"Brand new in Rosset Bay…"），目录表没标，出片时没人发现。证据包：`~/Library/Application Support/magicengine/evidence/2026-10-16-tale-vocals/`。

## 1. 为什么不在出片机里现场转写
出片机是开机自启的后台程序，装语音识别模型又重又慢（整首 2 分钟音乐转写要几十秒到几分钟），还要联网/大模型文件。**转写放在入库那一步（离线、一次）；出片机只做查表。**

## 2. 做法（复用现有目录表 `engines/remotion/catalog/music.json` 与出片前置检查）
- 目录表每首曲新增两个可选字段：`vocals: 'none' | 'present' | 'unknown'`（缺省 = `unknown`）与 `sha256`、`vocalScanAt`、`vocalEvidence`（转写片段，≤200 字）。
- 离线工具 `tools/scan-music-vocals.py`（照今天用的 whisper 转写命令）：整首转写；任何 `no_speech_prob < 0.5` 且含 ≥3 个英文词/≥3 个汉字的片段 → `present`；全空或只有「Music / 你 / Thanks for watching」这类常见幻听词 → `none`；其余 → `unknown` 交人听。**转写会对纯音乐产生幻听，所以「unknown」必须是拦截状态，不是放行。**
- 出片机（`remotion-branch.mjs` 暂存音乐那一步，及 recipe 路径的 BGM 解析）：按 **文件内容 sha256** 查目录表（不按文件名，因为复制/`_n` 归一化版本会改名）：`present` → 拒绝出片，错误写明曲名与证据；`unknown`/查不到 → 同样拒绝，提示「先跑 scan-music-vocals」；只有 `none` 放行。
- `_n`（响度归一化）版本是新文件、sha 不同：工具生成 `_n` 时同时把 `vocals` 从源曲继承并写入目录表（归一化不会消除人声）。
- 不做：不在出片机里调用语音识别；不改已发布内容；不全局关闭（缺省仍是拦截）。

## 3. 验收
- 单测：`present` / `unknown` / 查不到 sha / `none` 四种；同曲不同文件名同 sha 命中同一条；`_n` 继承。
- 当场试跑：①用 `analytical-scholar` 提一张无害测试单 → 必须被拦且回执写明原因；②用已确认 `none` 的曲子提单 → 正常出片到待审。
- 现有 engine 与出片机测试基线不变。

## 4. 复用声明
复用目录表、sha256 习惯、出片前置检查位；平台共享；行业/客户专属内容为零（曲库是平台共享资产）。
