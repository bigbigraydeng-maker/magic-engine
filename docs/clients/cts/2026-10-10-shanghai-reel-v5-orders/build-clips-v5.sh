#!/bin/bash
# 复现第三版（15 秒版）新增的两条镜头。只改画面亮度/取景，不生成任何 AI 画面。需要 ffmpeg。
# 用法: bash build-clips-v5.sh <CTS 素材根目录>   例: ~/Dropbox/MagicLab_Studio/CTS
set -e
ROOT="${1:?给 CTS 素材根目录}"
S="$ROOT/footage/stock"; C="$ROOT/remotion-assets/clips"
# 外滩夜景：放大 1.4 倍、让灯塔落在画面右侧（不压标题）、提亮暗部（江面不再死黑）
ffmpeg -nostdin -y -v error -ss 0 -t 3.2 -i "$S/v_bund_36546365.mp4" \
  -vf "scale=1512:2688:flags=lanczos,crop=1080:1920:0:330,curves=all='0/0.06 0.2/0.50 0.5/0.80 1/1',fps=30,format=yuv420p" \
  -an -c:v libx264 -crf 17 "$C/v3_bund_night_zoom.mp4"
# 西湖：只在标题带（y≈700）压低高光，白字不再叠在亮樱花上
ffmpeg -nostdin -y -v error -i "$C/v2_westlake_hangzhou.mp4" \
  -vf "geq=lum='lum(X,Y)*(1-0.42*exp(-pow((Y-700)/120,2)))':cb='cb(X,Y)':cr='cr(X,Y)',format=yuv420p" \
  -an -c:v libx264 -crf 17 "$C/v3_westlake_band.mp4"
