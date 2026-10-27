---
id: 2026-10-26-failover-deepseek-needs-pm-data-call
title: 要不要让备用模型包括 DeepSeek：它是中国公司，简报要喂的是全部客户的私信和邮件原文，范围比现有「CTS 通话转写」那个先例大得多，开关默认关着等 PM 点头
status: decided
owner: pm
decided_on: 2026-10-26
source: session:96dc6edf
verify_by: 2026-11-09
verify_how: PM 在对话里明确回「开 DeepSeek」或「不开」。开的话：在 Render 服务 crazycontent 设 AI_FAILOVER_ALLOW_DEEPSEEK=1，改完必须手动触发一次部署并回读部署时间晚于改变量；不开则本卡关闭。另核对先例：2026-10-12-cts-call-transcribe-via-twilio 那张卡的 CTS 书面同意是否已拿到
---
核实过：库里最近 6 条通话分析确实是 deepseek-chat（最新 10-22），Render 上钥匙已配，先例是真的。
但先例只涉及 CTS 一个客户的通话，且那张卡写着「放开前需 CTS 书面同意并核对数据条款」仍是 decided。简报覆盖所有客户的所有对话。
没有这个开关，Claude 一家备用已经能解决 8 天断电的全部问题，所以不急；有了它只是多一层保险。
