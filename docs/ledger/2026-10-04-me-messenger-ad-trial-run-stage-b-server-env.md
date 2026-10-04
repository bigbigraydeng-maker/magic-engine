---
id: 2026-10-04-me-messenger-ad-trial-run-stage-b-server-env
title: 私信广告试跑第二阶段：让 ME 自己的代码在带授权的服务器环境真跑一遍，目前没有这个环境，需 PM 决定怎么拿
status: decided
owner: pm
decided_on: 2026-10-04
source: pr:2224
verify_by: 2026-10-11
verify_how: 查三件。①第二阶段是否已在服务器上跑通，回执写进 docs/ledger/evidence/；②回读里能否读到 Meta 自动问候语（阶段 A 验不了）；③等转码、补暂停、时间预算对真实账户是否按设计工作。没跑通之前，PR 2224 不得说可以上线
---
阶段 A 已做完（见证据文件），只验了 Meta 接受这组参数，没验 ME 自己的代码。
本机拿不到生产授权，也不会去读密钥文件；需要 PM 决定走哪条路拿到带授权的环境。
阶段 A 的回执：docs/ledger/evidence/2026-10-04-me-messenger-ad-trial-run-awaiting-pm--stage-a.md
