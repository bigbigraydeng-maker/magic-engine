# CTS 四个产品的 I2V 新素材方案（只出方案，未生成任何视频、未花钱）

2026-10-04 卫青（广告）+ 东坡标准的联合小组出。PM 要求：广告素材太老套，用 I2V 做一批，默认走 Muapi；四个产品是圣诞团订单、2027 Natural China、2027 年 5 月 Best of China、Panorama 团。

**核实方式**：调查员先出了一版，卫青随后对每个产品的官网页面逐一重新抓取核对（2026-10-04 当天），下面的事实表是核对后的版本，调查员原版有两处错已更正（见「更正记录」）。

**基线提醒**：2026-10-01 至 10-02 CTS 个人广告账户因付款异常停摆约 39 小时，10-03 又补量反弹，这三天的花费和留资都不是常态，做效果对比、算每条留资成本时基线请取 9/22 到 9/30。

## 一、官网事实表（官网可溯，2026-10-04 核对）

| 产品 | 官网页面名称 | 天数 | 价格（NZD，双人间每人） | 出发 | 链接 |
|---|---|---|---|---|---|
| 圣诞团 | Christmas & New Year in China | 16 | 7,188（单人房 8,156） | 2026-12-22（官网只列这一个） | /tours/china/discovery/china-icons-collection |
| Natural China（签名版） | China Signature — Natural China | 16 | 7,349（单房差 +1,895） | 2027-03-26 至 04-10 | /tours/china/signature/landscapes |
| Natural China（发现版） | China Discovery — Natural China | 14 | 官网写 TBC | 官网写 TBC | /tours/china/discovery/natural-china |
| Best of China | China Discovery — Best of China | 15 | 4,080（单人房 4,880） | **官网只显示 2027-03-11 一个** | /tours/china/discovery/essentials |
| Panorama | China Signature — China Panorama | 27 | 10,899 | 2027-05-08 至 06-03；2027-10-16 至 11-11（共两个出发期） | /tours/china/signature/grand-tour |

域名 ctstours.co.nz。圣诞团基督城版（15 天，NZ$6,188）是调查员报的，**卫青没有核**。

## 二、更正记录（调查员原版错了的地方）
1. **Panorama 不是四个出发日，是两个出发期**：原版把 5/8、6/3、10/16、11/11 当成四个出发日，实际 6/3 和 11/11 是返程日（27 天）。
2. **官网上没有「5 月的 Best of China」**：原版写 Best of China 有 2027-03-11 和 2027-05-13 两个出发日，实际 2027-05-13 出发的是 **China Signature — Silk Road**（18 天，NZ$7,999），页面上那张卡是别的团。Best of China 官网页只显示 3/11 一个出发期；而台账和手册写「3 月 Best of China 已招满」，两边对不上，需 PM 说明。
3. 「官网上没有 Panorama」这个担心不成立：Panorama 就是 Signature 系列的 Grand Tour（页面名 China Panorama）。

## 三、真实素材盘点（调查员报，卫青没有逐张打开核对）
- [W] 本机 Dropbox 的 Wikimedia 库约 102 张，只有 19 张竖版，要署名（CC 协议，按改编处理要同协议分享，先用 CC0 / CC BY）。
- [I] 官网首页 iStock 付费图库图。
- [P] 本机 Dropbox footage/photos 的 Unsplash / Pexels 图 48 张。
- [T] 官网 Supabase 图库 tour-images（623 个文件、约 60 张不同的图）和官网仓库图，**来源没有记录**。
- 没有任何已证实的 CTS 自有实拍。素材目录实际是 ~/Dropbox/MagicLab_Studio/CTS，不是 ~/Dropbox/CTS。
- 按来源事实判断，不按文件名；图库图和 AI 输出一律只能做氛围，不能冒充 CTS 实拍承诺。

## 四、爆款配方对账表（旅游类 504 条已分析样本）

| 配方列（平均播放） | 这次怎么满足 | 结果 |
|---|---|---|
| 开场：视觉冲击 2300 万、文字提问 600 万；风景空镜仅 150 万 | 第 1 帧用提问或数字字幕，画面压在真图上，不用风景空镜 | 满足 |
| 满屏文字（3500 万）、快切（镜头中位 2.3 秒，首切 2.85 秒） | 字幕每行不超过 6 个词，每镜 2 到 3 秒 | 满足（只是节奏参数） |
| 真人出镜 ugc_selfie（880 万，59 条） | 没有真人素材，AI 人脸不能用 | **做不到** |
| 航拍（900 万） | 只能 AI 模拟航拍，或用 Dropbox 里的真 Pexels 航拍（片尾标 Footage: Pexels） | 部分满足 |
| 真实感（均分 6.55/10）、幽默/共鸣风格 | 全是图库图和 AI 图，没有 CTS 自拍的粗糙感 | **做不到** |
| 配乐 upbeat（1700 万） | 音量压到人声的 20% 到 25% | 满足 |

另外：不做 logo 开场和尾卡，但全程叠 logo 水印层；不烧 CTA；字落在 y=270 到 1248 安全区；暂不做旁白（英文旁白工具的钥匙没接）；成片必须真播放确认有声音，再过东坡审查。

## 五、镜头方案（Muapi kling-v2.1-standard-i2v，约 US$0.225 一条 5 秒，源图先裁 9:16）

安全运镜只用：rack focus / crane up、down / 横移 / tilt / pull-back reveal / aerial drift，每镜换不同的环境动态；禁用 shallow depth of field；兵马俑、密集人脸、密集小字的镜头不走 i2v，改走真图运镜（零重绘）。风险按「低/中/高」标。

### ① 圣诞团（4 条 AI + 3 条真图运镜）
1. [W] shanghai/zhujiajiao_0，crane down 加水面雾，低，「Venice of Shanghai?」
2. [I] christchurch-departure-v2，横移加灯串闪，中（人脸多，糊了改真图运镜），「Christmas Eve, Shanghai」
3. [W] beijing/greatwall_0，pull-back reveal 加云雾，低，「Mutianyu, Day 7」
4. [W] chongqing/hongyadong_0，tilt up 加灯光，中（招牌小字），「Chongqing, Day 13」
5. [W] beijing/forbiddencitysnow_0，真图运镜，高（人群），「Forbidden City, Day 6」，字幕不写「下雪」
6. [W] xian/terracotta_0，真图运镜，高（兵马俑），「New Year's Eve in Xi'an」
7. [W] xian/tangcity_0，真图运镜，高（人脸），「5 cities. 16 days.」

### ② Natural China（6 条 AI + 1 条真图运镜，按签名版）
1. [W] chongqing/gorges_0，aerial drift 加江雾，低，「3 nights on the Yangtze」
2. [I] blog-article2（长江游轮），横移加水波，低，「Three Gorges, by cruise」
3. [I] city-chengdu-v2（熊猫），rack focus 加竹叶，中（毛发），「Giant pandas in Chengdu」
4. [I] city-zhangjiajie-v2，crane up 加云海，低，「Zhangjiajie, Day 11」
5. 官网仓库 tianmen-mountain-glass-walkway.jpg，tilt down 加云，中，「Walk the Glass Skywalk」，用前先核图来源
6. [W] chongqing/liziba_0，横移，中（建筑会被重画），「A train through a building?」
7. [W] chongqing/hongyadong_1，真图运镜，招牌字多，「Chongqing by night」

### ③ Best of China（4 条 AI + 3 条真图运镜）——出发期待 PM 确认后再定字幕
1. [P] p_leifeng，pull-back 加湖雾，低，「15 days. 4 cities. NZ$4,080.」
2. [W] hangzhou/westlake_0，横移加水波，低，「West Lake boat tour」
3. [W] hangzhou/longjing_0，tilt 加茶园雾，低，「Longjing tea tasting」
4. [W] beijing/greatwall_2（CC0），crane up 加云，低，「Great Wall, Day 4」
5. [W] xian/terracotta_1，真图运镜，高（兵马俑），「Terracotta Warriors, Day 7」
6. [W] beijing/forbiddencity_2，真图运镜，高（人群），「Forbidden City, Day 3」
7. [W] shanghai/pudong_0，真图运镜，高（建筑和招牌），「Shanghai, Day 12」
官网 Puyuan 古镇没有真图，不能用乌镇冒充。

### ④ Panorama（6 条 AI + 2 条真图运镜）
1. [T] great-wall-mist，pull-back 加云雾，低，「27 days. One trip.」，来源未证实
2. [I] cta-banner（长江日落游轮），aerial drift，低，「5-star Yangtze cruise」
3. [I] hero-river-sunset-v3（漓江），crane down 加晨雾，低，「Li River cruise」
4. [I] stopover-shanghai-suzhou（江南水乡），横移加水波，中，「Suzhou, Day 23」
5. [I] city-chengdu-v2（熊猫），rack focus，中，「Pandas, Day 13」
6. [P] p_westlake，横移加水波，低，「West Lake, Day 21」
7. [W] xian/terracotta_0，真图运镜，高（兵马俑），「Terracotta Warriors, Day 7」
8. [W] beijing/forbiddencity_0，真图运镜，高（人群），「Forbidden City, Day 3」
没有可证实的大理、石林、阳朔鸬鹚图，这三处不补。

## 六、成本
AI 20 条 × US$0.225 = US$4.50，加 30% 重试，合计约 **US$5.85**（单价是 2026-07-08 的记录，今天没复核，Muapi 余额也没查）。真图运镜 9 镜在本机用 ffmpeg 做，不花钱。**等 PM 对总价点头才生成。** 另：Creatomate 额度已用 78%（2000 用了 1600），渲染成片要另算额度。

## 六点五、PM 已拍板（2026-10-04，卫青窗口）
- **推广产品定为五个**：圣诞团（2026-12-22 出发）、A Tale of Two Cities（10 天，NZ$3,480，2027-03-18）、Best of China（15 天，NZ$4,080，2027-03-11）、Natural China 签名版（16 天，NZ$7,349，2027-03-26 至 04-10）、China Panorama（27 天，NZ$10,899，**5 月档 2027-05-08 至 06-03**）。以上均为 2026-10-04 官网核对值。
- **5 月只推 Panorama**，Silk Road（18 天，NZ$7,999，2027-05-13 至 05-30，官网标「名额有限」）本轮不做素材；Panorama 的 10 月档（10/16 至 11/11）本轮也不是主推。
- **素材来源规则（卫青 10/4 核实 iStock 授权原文后定）**：买的 iStock 图（约 27 张，高清横图）授权禁止用于机器学习或人工智能目的，**不得喂给 AI 图生视频模型**，只做不用 AI 的运镜（推拉平移、视差）；AI 图生视频只用授权清楚的图（公共领域或署名图、CTS 自己拍的）。要用买的图做 AI 视频，须先向 iStock 要书面许可，建议由 CTS 询问。本文第五节镜头方案里标 [I] 的 AI 镜头因此全部作废，要么改成运镜、要么换成合规图，待素材盘点结果出来后重排。
- 第七节第 1、3 项已有答案；第 2 项（Natural China 版本）按已核实的签名版先做，发现版价格日期官网仍写待定。

## 七、待 PM 拍板
1. 「5 月的 Best of China」是哪一个团？官网上 5/13 出发的是 Silk Road，Best of China 只显示 3/11。
2. Natural China 做签名版（3/26 出发，NZ$7,349）还是发现版（价格日期官网都是待定，不建议）？
3. Panorama 主推 5 月出发期（5/8–6/3）还是 10 月（10/16–11/11）？
4. 总价约 US$5.85 能不能生成？
5. 要不要补真人？让 CTS 同事竖拍 15 秒，才能满足「真人出镜」和「真实感」两列。
6. iStock 图和 Wikimedia 图做成 AI 动画再投广告，授权行不行？需问 CTS，卫青没核实。

## 八、没验证 / 查不到
- 没有打开任何一张图确认内容，也没试过竖版裁切效果。
- iStock 与 CC 图能不能做 AI 改作，没核实。
- [T] 图库来源、官网仓库 18 张「微信图片」（2026-04-21）来源，都没有记录。
- ~/Dropbox/MagicLab_Studio/CTS/footage/ai/real2v 的 9 个视频来源没查。
- 圣诞团基督城版价格、Panorama 含项、Best of China 为何 3 月已招满与官网不一致，都没核。
- 配方样本含单条 2.3 亿播放的爆款，均值被拉高，仅供参考。
