# 东西该放哪（2026-08-03 定）

PM 问：「发票合同和素材，该放 Claude 客户档案下还是 Dropbox 里？」
这份文档是答案，免得每次重新讨论。

---

## 一句话规则

**能搜索能引用的文字 → 代码仓；有法律效力或很大的二进制 → Dropbox；系统真正要用的素材 → 最终进数据库。**

---

## 三类东西，三个地方

| 东西 | 放哪 | 为什么不能放另一边 |
|---|---|---|
| **合同 · 发票 · 报价单** | `Dropbox/Magic Engine/by-client/<客户>/` | 里面有银行账号、电子签名、客户金额。**代码仓会推到 GitHub，绝不能进**。Dropbox 还自带版本历史，也方便直接发给客户 |
| **素材**（视频 · 图片 · 音乐） | `Dropbox/MagicLab_Studio/` → 系统读取入库 | 几百 MB 的二进制进 git 会把仓库撑爆，而且 git 对二进制没有增量。Dropbox 是**进料口**，权威副本最终在 Supabase |
| **文档**（策略 · 诊断 · 分析 · SOP · 规格） | 代码仓 `docs/` | 要版本管理、要能被 agent 搜索、要跟代码一起演进。放 Dropbox 就搜不到也引用不了 |

---

## Dropbox 里的两套客户目录（现状，注意别放错）

| 路径 | 装什么 | 命名 |
|---|---|---|
| `Magic Engine/by-client/` | **只装合同发票** | `01_CTS_Tours`、`02_Roman_Hu`（带编号前缀） |
| `MagicLab_Studio/` | **只装素材** | `CTS`、`Oztop`（不带前缀） |

⚠️ **同一个客户在两处的名字不一样**，这已经出过事：30 Kiteroa 的 12 条实拍视频被放进了
合同库 `by-client/05_Kiteroa/`，系统永远读不到（素材只扫 `MagicLab_Studio`）。
**2026-08-03 已修正** —— 素材移到 `MagicLab_Studio/Roman_HU/projects/30-Kiteroa/`，
`05_Kiteroa/` 已清空删除；合同发票留在 `03_WeiWorks_Kiteroa/`（位置本来就对）。

**放错的判断很简单**：是 PDF/DOCX 就进 `by-client`，是 mp4/mov/jpg 就进 `MagicLab_Studio`。

---

## MagicLab_Studio 的目录即意图

丢进哪个文件夹，就决定了系统怎么理解这份素材 —— **不用填表，不用改名**：

| 路径 | 系统怎么理解 | 能打真实价格 |
|---|---|---|
| `<客户名>/footage/client_provided/` | 客户实拍 / 我们实拍 | ✅ |
| `<客户名>/footage/stock/` | 图库下载 | ❌ |
| `<客户名>/footage/ai/`、`library/i2v_out/` | AI 生成 | ❌ |
| `<客户名>/output/`、`projects/` | 我们的成片与中间产物 | ❌ 不是素材 |
| `_shared/library/` | 行业共用图库 | ❌ |
| `_shared/music/` | 共用音乐 | — |
| `_shared/raw_intake/` | 待归属，系统看图猜客户后请你点一下确认 | ❌（确认前一律按最严格处理） |
| `相机上传/` 及其它顶层目录 | **不扫**（混私人内容） | — |

> 拿不准就丢 `_shared/raw_intake/` —— 猜错的代价是点一下确认，不是数据泄漏。

### 中介客户多一层：楼盘

地产中介名下有多个楼盘，素材**绝不能跨楼盘串用**（背后是竞品开发商）。所以路径多一层：

```
MagicLab_Studio/<中介名>/projects/<楼盘名>/
    footage/client_provided/   ← 该楼盘实拍（能打真实价格）
    output/reels/              ← 我们做的成片（不是素材）
    scripts/                   ← 出片脚本
```

实例：`MagicLab_Studio/Roman_HU/projects/30-Kiteroa/`。

⚠️ **同一个楼盘的合同发票不跟素材放一起** —— 发票走 `by-client/<开票主体>/`，
按**开票公司名**建目录（30 Kiteroa 的开票主体是 Wei Works Ltd，所以在
`03_WeiWorks_Kiteroa/`）。素材按楼盘分，账按付钱的公司分，这两个维度本来就不一样。

---

## 代码仓 `docs/` 的分层

| 位置 | 装什么 |
|---|---|
| 根目录 8 个大写文件 | 唯一真相源：STATE · ROADMAP · ENV · DECISIONS · PITFALLS · ARCHITECTURE · PRODUCT · DESIGN_SYSTEM |
| `specs/` | 单个功能的设计文档 |
| `sops/` | 可复用的操作手册 |
| `clients/` | 客户交付物与分析 |
| `agents/` | agent 人设 |
| `history/` | 完成日志与历史快照 |
| `archive/` | 已作废但留档 |

**新文档不要往根目录扔** —— 根目录只留那 8 个。
