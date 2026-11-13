---
id: 2026-11-12-twinme-autocut-card-layout-built
title: TwinMe 自动排卡第一版做好（草稿改动单#125，未合并）：卡片由程序按口播稿和时间轴自动排，没说过的字上不了屏
status: decided
owner: agent
decided_on: 2026-11-12
source: session:6610c9ad
verify_how: 看 docs/clients/twinme-samples/2026-11-12-autocut-darui-north-island.mp4 和 2026-11-12-autocut-fairsquare-new-topic-v2-framed.mp4（PM 指出第一版人像出框，已改成按每个数字人测一次的脸部位置来放）：卡片在说到那句话时出现，卡上没有口播里没说过的数字或说法；新 ME 仓库 https://github.com/magic-engine-dev/magic-engine-platform/pull/125 是草稿状态。
---
PM 11-12 回「做自动排卡」。
做了：一套所有客户共用的卡片动画（品牌色、名字栏、圆窗人像固定，10 种信息卡），加一个排卡程序：模型只提议「哪段话配哪种卡、引用哪几个字」，程序按真实逐字时间换算出现时间；上屏文字必须是说过的话或确认过的稿件，数字必须说过，不合格就改成显示原话。
实测：大瑞北岛（同主题，8 张卡）和方正武汉客人案例（新主题、新品牌色，7 张卡，拦下 7 处没说过的字）两条，都在 ChatCut 本机渲染导出，逐镜看过。测试 13 条全过，格式和类型检查通过。
没做：没接进工单流程（剪辑仍手动触发）；生产要改走平台的 AI 记账通道；人像取景要按形象配偏移（方正那条头顶被切）；固定品牌片尾卡；要求工单把客户确认过的脚本一起传进来，否则语音识别错字会原样上卡。
**11-12 PM 回「接进工单」后续**：已接进工单（同一草稿改动单 #125，加了数据库迁移 0157，A 级，留给 Ray 亲手合）。数字人出片进「剪辑中」后系统自动排一版卡；工作台剪辑块显示每张卡、被拦下的字，能下载剪辑包、重排；排不成不挡手动剪辑。引擎（jundongGit/digital-human 分支 feat/engine-v1-me-contract）加了取逐字字幕的接口。本机浏览器看过面板、下载成功；没在真实引擎上跑通整条链（引擎没部署、服务器没填引擎地址）。还没做：量脸位置的按钮、ChatCut 自动出片的常开电脑。 **11-12 PM：「这台电脑不负责出片，用 jundong 的电脑出片，功能上继续开发」**：出片机做好了（同一草稿改动单 #125）。不用 ChatCut，用 Remotion 在常开电脑上自动出片：领活 → 下载数字人视频 → 叠信息卡出片 → 传回 ME → 工单自动进质检；失败自动报回工单。本机整条链跑通一次（74 秒片子约 49 秒出完），成片 docs/clients/twinme-samples/2026-11-12-render-machine-fairsquare.mp4。安装说明 tools/twinme-render/README.md。还没做：装到 Jundong 电脑、服务器配出片机密钥；Remotion 超过 3 人的公司商用要买授权，上线前按实际人数确认。 **11-12 PM：「不用这个路线」**：Remotion 出片机整笔撤回（#125 第四次提交）。现行路线：每个品牌一个 ChatCut「X风格库」项目 + Jundong 的「按风格库剪辑」Skill，在 Jundong 电脑上出片。PM 的 ChatCut 账号已加入「方正风格库」，Skill 已导入（副本 b814add4）。下一步：排卡结果对上风格库组件，而不是用自己那套卡片动画。
