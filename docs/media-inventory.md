# 全机素材盘点（2026-08-03）

**为什么有这份文档**：ME 一直以为素材只有数据库里那 83 张。实际全机有 **6 处**互不相通的存放点，
而系统只看得见其中一处。做任何「素材不够 / 要花钱生成」的判断前，先看这里。

---

## 一句话结论

**客户真实拍摄的视频，全机只有 15 条**（Kiteroa 12 · Oztop 3 · CTS 0）。
其余上千个文件全是我们自己的产出、图库下载、或 AI 生成 —— 它们**不能给真实价格背书**。

---

## 六个存放点

| 位置 | 视频 | 图片 | 性质 | ME 看得见 |
|---|---|---|---|---|
| Supabase `visual-assets` | — | **83** | 系统内唯一素材源 | ✅ |
| `Dropbox/MagicLab_Studio` | 377 | ~1250 | 主工作库（Oztop 232 / CTS 145） | ❌ |
| `Dropbox/Magic Engine/by-client` | 23 | 0 | **合同发票库**，混进了 Kiteroa 实拍 | ❌ |
| `Dropbox/相机上传` | 85 | ? | PM 自己拍的，全部 7 月以来 | ❌ 不扫（混私人内容） |
| `~/Downloads/Media` | ~15 | — | 散落成品 + **实拍 + 16 首音乐**，从未归档 | ❌ |
| `~/Documents/Claude` | 238 | 2313 | 代码仓，`cts reels` 被 11 个工作副本各复制一份 | ❌ 不算素材 |

---

## MagicLab_Studio 那 377 条视频，其实没有素材

拆开看构成，会发现「素材多」是错觉：

**Oztop 232 条**
| 目录 | 数量 | 是什么 |
|---|---|---|
| `projects/*`（e1_segments、各类 cards） | ~84 | 我们做片过程中的中间产物 |
| `output/reels` | 39 | 我们的成片 |
| `footage/stock` | 21 | 图库下载 |
| `library/i2v_out` + `footage/ai` | 20 | AI 生成 |
| **`footage/client_provided`** | **0 → 3** | **客户实拍**（本次归档补入，见下） |

**CTS 145 条**
| 目录 | 数量 | 是什么 |
|---|---|---|
| `footage/ai` + `_kling_raw` | ~56 | AI 生成 |
| `footage/stock` | 45 | 图库下载 |
| `output/reels` + `output/youtube` | 23 | 我们的成片 |
| `archive/rejected-fake-motion` | 2 | 已废弃的假运镜 |
| **客户实拍** | **0** | **一条都没有** |

> CTS 的「千篇一律」不是排版问题，是**材料问题** —— 所有画面都来自公用图库，同行拿到的是同一批。

---

## 全机客户实拍清单（唯一能打真实价格的素材）

| 客户 | 数量 | 位置 | 说明 |
|---|---|---|---|
| **30 Kiteroa** | 12 | `MagicLab_Studio/Roman_HU/projects/30-Kiteroa/footage/client_provided/` | iPhone 原件。**2026-08-03 全部 12 条已入库**，挂在 Kiteroa 楼盘下，共 173 秒 |
| **Oztop** | 3 | `MagicLab_Studio/Oztop/footage/client_provided/` | 见下方归档记录 |
| **CTS** | 0 | — | — |

### 系统里已有的真实片段（`video_clips` 表，`track='a_real'`）
| 客户 | 条数 | 来源 | 用过 |
|---|---|---|---|
| Oztop | 7 | 展厅实拍（`Oztop/footage/brand/`） | 0 次 |
| Roman HU | 7 | 30 Kiteroa 实拍（PM iPhone 2026-07-24） | 各 0-1 次 |
| CTS | **0** | — | — |

> **只有 CTS 是「不花钱就出不了片」的**。Oztop 和 Roman 都已有真实片段可用，而且几乎没被用过。
> 归属存疑：30 Kiteroa 的实拍挂在 Roman HU 名下，但系统里另有 `30 Kiteroa Rothesay Bay` 客户档（0 素材）。

**Oztop 那 3 条**（本次从 `~/Downloads/Media` 归档，**复制不移动**，原文件未动）：
- `OZtop PetFlooring 26.6.4.mov` — 宠物踩地板实拍
- `OZtop Scratch 26.6.4.mov` — 抗刮测试实拍
- `OZTopBATiger1.mp4` — ⚠️ **性质待确认**，不确定是实拍还是加工过的，用于真价前需人工过目

---

## 本次动作

1. Oztop 3 条实拍 → 归入 `Oztop/footage/client_provided/`（该目录此前是空的）
2. `~/Downloads/Media` 的 4 首音乐 → 归入 `_shared/music/`（16 首 → 20 首）
   - ⚠️ 库内有若干 `xxx (1).mp3` 重复文件，未删（删文件要 PM 点头）

---

## 对「要不要花钱开工厂」的影响

一条片子至少 4 成镜头必须是新画面。新画面只有两个来源：

- **真实拍摄** → $0，且能打真实价格
- **AI 把照片变活** → $0.225/条，**不能**打真实价格

CTS 真拍视频为 0，Oztop 为 3 条 —— 所以现在开工厂，绝大部分画面只能靠花钱生成，
而这正是 Oztop 那 5 条被退回的原因（AI 底料冒充真产品）。

**结论：先把真实素材进料修通，比现在开工厂划算。**

---

## 待办

- [ ] Dropbox 进料接进 ME（素材库第 3 步），`MagicLab_Studio` 现有目录结构直接就是分层
- [ ] `Magic Engine/by-client/05_Kiteroa` 那 12 条实拍归到 Kiteroa 名下（该客户未建工厂配置）
- [ ] `OZTopBATiger1.mp4` 人工确认是不是实拍
- [ ] `_shared/music` 去重（20 首里有 5 对 `(1)` 重复）
