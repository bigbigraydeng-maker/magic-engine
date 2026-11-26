---
id: 2026-11-18-confirmation-upload-autofill
title: 确认单加「上传文件，自动填表」：上传旧确认单（Word/PDF/文本），AI 读出来填好表单，员工核对后再生成
status: decided
owner: agent
decided_on: 2026-11-18
source: session:b42135d2
verify_by: 2026-12-02
verify_how: 用 CTS 账号打开确认单生成器，上传一份真实的旧确认单（例如 CTS4270729 那份 Word）：(1) 20–60 秒内表单被填好，团号、航班、每天行程、酒店、包含/不包含和原文一致；(2) 不会补原文里没有的内容；(3) 有两个不同团号时页面「核对」提示里会说。不成时第一步：看页面报的错——「AI 密钥没配置」说明服务器缺 ANTHROPIC_API_KEY；超时说明文件太大，换短一点的。本机没用真密钥跑过（规则不许读 .env.local），所以这一步只有上线后才能验
---
PM 11-18：「学习 Tailor-made 功能，可以上传文件，然后自动生成」。
接口 POST /api/clients/[id]/confirmation/extract：先验登录权限和旅游行业；读 Word（解 zip 取正文）/ PDF（作为文档直接给 AI）/ 文本；一次 Claude 调用，强制走提交工具，只照抄不补；结果清洗后返回，不落库。
不扣 MTC（与 Tailor-made 上传解析同口径）。小贴士和封面不从文件读，保持员工的设置。文件内容会发给 Anthropic（和 Tailor-made 上传同口径）。
