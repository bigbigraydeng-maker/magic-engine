# CTS 上海周边团 Reel 参数与素材（2026-10-06）
- `E3.evergreen.props.json`：常年款（价格页日期行 = 免费改期）；`S3.sprint.props.json`：冲刺款（日期行 = 出发日，只给再营销）。模板 = `list`，参数格式见 `scripts/factory-worker/engines/remotion/README.md`。
- `build-clips.sh`：复现镜头（真实像素，无 AI）。素材来源与核实见 `../2026-10-06-shanghai-price-drop-creative-plan.md` 第九节、第十五节。
- 样片的 `footnote` 是 `SAMPLE…` 防护字样，**正式工单必须换成签证免责并核对放得下**（常年款价格页脚注已贴 y1248 线）。
- 音乐 `Building Momentum`：节拍表用 `~/Projects/cts-remotion/tools/beats.py`（100 BPM，偏移 0.09）算出，已写进 props 的 `beats`。
- 创建工单需要：`brief.engine='remotion'`、`brief.remotion={template:'list',props}`、`brief.copy.endcard={cta,url}`（带 UTM）、预算上限 > 0。**写生产库，需 PM 授权。**
