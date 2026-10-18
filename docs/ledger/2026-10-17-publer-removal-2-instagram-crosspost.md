---
id: 2026-10-17-publer-removal-2-instagram-crosspost
title: Instagram 跟发整套下线（Publer 退役第 2 步），Instagram 自动发布能力现在为零
status: decided
owner: agent
decided_on: 2026-10-17
source: session:c45254ff
verify_by: 2026-10-24
verify_how: 合并后看三件事：1 工厂发布的定时任务返回里不再有 instagram 字段，且 Facebook Reel 照常发出；2 今日待办里不再出现「Instagram 账号掉线 / 同步失败」两类条目；3 执行 git grep instagram-crosspost -- src scripts 无结果。任一不成，第一步看这个 PR 的改动范围。
---
PM 已取消 Publer 订阅，Instagram 跟发（把工厂 Reel 通过 Publer 复制到 Instagram）完全靠 Publer，代码一直默认只存草稿、生产从未真发，所以整套删除。
下线后 Instagram 自动发布能力为零；改走 Meta 官方接口的评估见 2026-10-07-instagram-meta-native-feasibility，暂缓。
删除范围：工厂 Instagram 跟发适配器、回执、事件、待办生成、本地试跑脚本，以及三个环境变量说明。Publer 其余代码由后续 PR 处理。
