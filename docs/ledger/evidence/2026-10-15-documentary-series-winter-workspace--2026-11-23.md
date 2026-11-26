# 证据 · 2026-10-15-documentary-series-winter-workspace · 2026-11-23
fetched_at: 2026-11-23T08:15:49+1300
查了什么：①生产库里谁有「系列视频关联链接」配置；②这些已关联视频能不能读到真实公开播放数；③其他客户能不能拿到 CTS 配置、旧编辑能不能覆盖新编辑（主干代码与测试）。
数字：①全库只有 CTS Tours NZ 一家有 documentary_links，关联了 4 集（苏州、杭州、重庆、上海），均为 YouTube 链接。②YouTube 公开数据接口今晚实读：苏州 36 播放/0 赞，杭州 10/0，重庆 50/2，上海 40/1，4/4 读取成功。③主干 manifest.ts 按客户编号取配置（manifestFor 只返回匹配客户），route.ts 遇过期编辑返回 409；该目录 2 个测试文件 11 条今晚本地跑全过（含「不把 CTS 配置漏给别的客户」「旧快照被拒」两条）。
来源/命令：只读 REST clients?factory_config->documentary_links=not.is.null；YouTube videos?part=statistics；npx vitest run src/app/api/clients/[id]/content-factory/series。
结论：成。限制：后台页面要登录，夜巡没打开页面本身，计数是直接向数据源核的。
