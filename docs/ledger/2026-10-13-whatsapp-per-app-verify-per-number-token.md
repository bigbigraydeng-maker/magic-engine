---
id: 2026-10-13-whatsapp-per-app-verify-per-number-token
title: NAL 的 WhatsApp 号码走官方接口：收消息按应用验签、发消息按号码取各自令牌（CTS 行为不变）
status: done
owner: agent
decided_on: 2026-10-13
source: session:12233466
verify_how: 看 PR 草稿是否带齐风险级别 A、当场试跑记录、DeepSeek 轮数花费；统筹问 PM 拿到「合 N」之前不合并；库里两张表要先建、再上代码
done_on: 2026-10-13
done_ref: pr:2541
---
代码、测试、当场试跑、两轮 A 级两审都做完，草稿 PR 已开（pr:2541），等统筹问 PM 拿「合 N」。
上线顺序：先在库里建表（两份迁移，需 PM 同意）、再上代码；接入 NAL 时令牌和应用密钥要一起登记。
没验证的：真实 Meta 推送、NAL 真实号码、真实授权发信，要 56 号配好后用测试号验。
