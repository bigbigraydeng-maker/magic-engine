# CTS 团编号草稿（2026-10-10，待 PM 与 CTS 确认）

规则：团编号 = 国家两位字母 + 团的短缩写；短途停留团（Stopover）中间加 `ST`，城市用机场三字码加天数。班期编号 = 团编号 + 出发日期（日+月份英文缩写+两位年份）。编号一经确认不随团名改动而变。
数据来源：chinatravel 仓库主干 `src/lib/data/tours.ts`（2026-10-10 读取，33 个团，其中 1 个未上架）。编号为草稿，33 个互不重复（脚本校验）。

| 团编号 | 团名 | 天数 | 班期编号（已排的出发日期） | 网站内部标识 | 状态 |
|---|---|---|---|---|---|
| `CN-LEGACY` | China Signature — Legacy of China | 17 Days | CN-LEGACY-13AUG26、CN-LEGACY-15OCT26、CN-LEGACY-28MAY27 | `china/signature/imperial-heritage` | 在售 |
| `CN-NAT16` | China Signature — Natural China | 16 Days | CN-NAT16-26MAR27 | `china/signature/landscapes` | 在售 |
| `CN-PANO` | China Signature — China Panorama | 27 Days | CN-PANO-08MAY27、CN-PANO-16OCT27 | `china/signature/grand-tour` | 在售 |
| `CN-SILK` | China Signature — Silk Road | 18 Days | CN-SILK-13MAY27、CN-SILK-21OCT27 | `china/signature/silk-road` | 在售 |
| `CN-BOC` | China Discovery — Best of China | 15 Days | CN-BOC-11MAR27、CN-BOC-13MAY27 | `china/discovery/essentials` | 在售 |
| `CN-FIRE` | China Discovery — Fire & Fuzz | 10 Days | CN-FIRE-01NOV26 | `china/discovery/chongqing-chengdu` | 未上架 |
| `CN-GOLD` | China Discovery — Golden China | 12 Days | CN-GOLD-16NOV26 | `china/discovery/golden-china` | 在售 |
| `CN-NAT14` | China Discovery — Natural China | 14 Days | 无固定班期 | `china/discovery/natural-china` | 在售 |
| `CN-SHSUR` | China Discovery — Shanghai & Surroundings | 10 Days | CN-SHSUR-25MAR27 | `china/discovery/shanghai-surroundings` | 在售 |
| `CN-TALE` | China Discovery — A Tale of Two Cities | 10 Days | CN-TALE-18MAR27、CN-TALE-10JUN27 | `china/discovery/beijing-xian` | 在售 |
| `CN-XMAS` | China Discovery — Christmas & New Year in China | 16 Days | CN-XMAS-22DEC26 | `china/discovery/china-icons-collection` | 在售 |
| `CN-XMAS-CHC` | China Discovery — Christmas & New Year in China (Christchurch Departure) | 15 Days | CN-XMAS-CHC-22DEC26 | `china/discovery/china-icons-collection-christchurch` | 在售 |
| `CN-YUN` | China Discovery — Colorful Yunnan | 11 Days | CN-YUN-10SEP26 | `china/discovery/yunnan-explorer` | 在售 |
| `CN-ST-BJS3` | China Stopover — Beijing Express (3 Days) | 3 Days | 无固定班期 | `china/stopover/beijing-express` | 在售 |
| `CN-ST-BJS5` | China Stopover — Beijing (5 Days) | 5 Days | 无固定班期 | `china/stopover/beijing` | 在售 |
| `CN-ST-CAN3` | China Stopover — Guangzhou (3 Days) | 3 Days | 无固定班期 | `china/stopover/guangzhou` | 在售 |
| `CN-ST-CANSZ4` | China Stopover — Guangzhou & Shenzhen (4 Days) | 4 Days | 无固定班期 | `china/stopover/guangzhou-shenzhen` | 在售 |
| `CN-ST-CTU3` | China Stopover — Chengdu (3 Days) | 3 Days | 无固定班期 | `china/stopover/chengdu` | 在售 |
| `CN-ST-DYG3` | China Stopover — Zhangjiajie (3 Days) | 3 Days | 无固定班期 | `china/stopover/zhangjiajie` | 在售 |
| `CN-ST-KWL3` | China Stopover — Guilin (3 Days) | 3 Days | 无固定班期 | `china/stopover/guilin` | 在售 |
| `CN-ST-KWL4` | China Stopover — Guilin & Surrounds (4 Days) | 4 Days | 无固定班期 | `china/stopover/guilin-surrounds` | 在售 |
| `CN-ST-SHA2` | China Stopover — Shanghai Express (2 Days) | 2 Days | 无固定班期 | `china/stopover/shanghai-express` | 在售 |
| `CN-ST-SHA3` | China Stopover — Shanghai (3 Days) | 3 Days | 无固定班期 | `china/stopover/shanghai` | 在售 |
| `CN-ST-SHASZ3` | China Stopover — Shanghai & Suzhou (3 Days) | 3 Days | 无固定班期 | `china/stopover/shanghai-suzhou` | 在售 |
| `CN-ST-SHAWZ4` | China Stopover — Shanghai & Wuzhen (4 Days) | 4 Days | 无固定班期 | `china/stopover/shanghai-wuzhen` | 在售 |
| `CN-ST-TXN4` | China Stopover — Huangshan (4 Days) | 4 Days | 无固定班期 | `china/stopover/huangshan` | 在售 |
| `CN-ST-XIY3` | China Stopover — Xi'an (3 Days) | 3 Days | 无固定班期 | `china/stopover/xian` | 在售 |
| `JP-EXP` | Japan Discovery — Explorer | 14 Days | 无固定班期 | `japan/discovery/explorer` | 在售 |
| `JP-HIGH` | Japan Discovery — Highlights | 18 Days | 无固定班期 | `japan/discovery/highlights` | 在售 |
| `JP-SAKURA` | Japan Signature — Cherry Blossoms | 13 Days | JP-SAKURA-27MAR27 | `japan/signature/cherry-blossoms` | 在售 |
| `JP-ULT` | Japan Signature — Ultimate | 18 Days | 无固定班期 | `japan/signature/ultimate` | 在售 |
| `VN-HIGH` | Vietnam Discovery — Highlights | 12 Days | VN-HIGH-12MAY27、VN-HIGH-15OCT27 | `vietnam/discovery/highlights` | 在售 |
| `VN-PANO` | Vietnam Discovery — Panorama | 14 Days | 无固定班期 | `vietnam/discovery/panorama` | 在售 |

机场三字码对照：BJS 北京 · SHA 上海 · CTU 成都 · KWL 桂林 · XIY 西安 · CAN 广州 · DYG 张家界 · TXN 黄山；SZ 在 `SHASZ3` 指苏州、在 `CANSZ4` 指深圳，WZ 指乌镇。

待确认：① 编号写法是否合 CTS 归档习惯；② 两个 Natural China 用天数区分（16 天 / 14 天）是否可接受；③ 已过出发日期的班期（2026 年 8、9 月）是否还需要编号。
