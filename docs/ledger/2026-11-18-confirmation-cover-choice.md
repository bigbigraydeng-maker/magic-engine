---
id: 2026-11-18-confirmation-cover-choice
title: 确认单加「封面可选」：学 Tailor-made 的图片封面（大图 + 米色信息面板、红金配色），也可选简洁红条
status: decided
owner: agent
decided_on: 2026-11-18
source: session:b42135d2
verify_by: 2026-12-02
verify_how: 用 CTS 账号打开确认单生成器：(1) 「封面」里能选图片封面/简洁红条，图片能选「自动」或手选一张；(2) 预览第一页是大图封面，「下载 PDF」第一页是封面、后面是正文，封面图不丢；(3) 「下载 Word」第一页有图片、标题和团号等信息。不成时第一步：看封面图是否为空（预览里是黑底）——是的话说明读图接口没通
---
PM 11-18 要求「学习 Tailor-made 风格，也有封面可以选」。接着已合并的 magic-engine#3896。
封面图沿用 Tailor-made 同一批图（templates/tailor-made-itinerary/heroes）和同一套选图规则（按行程自动选，也可手选）；预览里的图走现有的 /api/clients/[id]/tailor-made/heroes。
Word 导出在服务端读同一批图，嵌进封面。老草稿没有封面字段时自动用「图片封面 + 自动」。不建表、不迁移。
