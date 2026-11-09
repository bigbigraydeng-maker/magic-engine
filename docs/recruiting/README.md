# 招募物料 · Recruiting

面向 Magic Engine 城市合伙人（分销 / 代理）招募的对外物料。

## 文件

| 文件 | 说明 |
|---|---|
| `city-partner-recruitment.pdf` | 城市合伙人招募手册（中文），可直接打印 / 发放的成品 |
| `city-partner-recruitment.html` | 上面 PDF 的源文件，改内容改这个，再重新生成 PDF |

## 状态

**内部草稿版。** 手册里的收入数字是说明性示例、非收入承诺；佣金结构与区域政策以正式合作协议为准。正式对外发布前建议过一次法务（尤其"符合澳新法规"这句话需要专业背书）。

## 怎么改内容 + 重新生成 PDF

1. 改 `city-partner-recruitment.html`
2. 用 headless Chrome 生成 PDF（深色区块 + 金色高亮要正确打印，关键是 `print-color-adjust: exact` 和把片段包成完整 HTML 文档）：

```bash
# 把 HTML 片段包成完整文档（加 print-color-adjust + A4 页边距），再打印成 PDF
python3 - <<'PY'
src = "city-partner-recruitment.html"
c = open(src).read()
i = c.find('</style>') + len('</style>')
extra = '<style>html,body{margin:0}* {-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}@page{size:A4;margin:14mm 0}section,.prod-card,.example,.compliance,.reward-banner,.cta,.earn-table-wrap{break-inside:avoid}</style>'
open("_wrapped.html","w").write(
  f'<!DOCTYPE html><html data-theme="light" lang="zh"><head><meta charset="utf-8">'
  f'<meta name="color-scheme" content="light">{c[:i]}{extra}</head><body>{c[i:].strip()}</body></html>')
PY

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --print-to-pdf="city-partner-recruitment.pdf" \
  --no-pdf-header-footer --virtual-time-budget=6000 --disable-gpu \
  "file://$(pwd)/_wrapped.html"

rm _wrapped.html
```

> 手册也有一份可交互的在线版（Claude Artifact），链接在 `docs/specs/` 会员体系设计记录里。
