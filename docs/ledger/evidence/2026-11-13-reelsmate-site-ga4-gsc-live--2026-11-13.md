# reelsmate.co.nz 统计与收录上线证据（2026-11-13）

- 网站：reelsmate-site 仓库 main 提交 87c48be，`./deploy.sh` 上线（12 项本地测试全过，含 4 项「只在报名成功后记事件」测试）
- 线上核对：`/`、`/zh/` 都带统计代码 G-JGYZ7SB4XM；`/robots.txt`、`/sitemap.xml` 均 200，谷歌爬虫身份访问也是 200
- GA4 实时报表：一条标明 TEST 的测试报名后看到 page_view、generate_lead 1 次；generate_lead 随后标为重点事件（标记在测试之后，所以那一次不计入重点事件）
- Enhanced measurement 的「表单互动」已关，避免点按钮就算一次
- Search Console：网域资源 reelsmate.co.nz 所有权已验证（DNS TXT）；站点地图状态「成功」，发现 2 个网址
- 不需要 GTM：两页静态站、一个事件，直接装 gtag 足够；新西兰无强制 cookie 弹窗，后续加隐私说明一句即可
