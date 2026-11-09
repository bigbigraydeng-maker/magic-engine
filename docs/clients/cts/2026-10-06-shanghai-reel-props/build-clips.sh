#!/bin/bash
# 复现 2026-10-06 样片镜头（只用真实像素，无 AI）。输出目录 = remotion-assets 下的 clips/。需要 ffmpeg。
# 用法: bash build-clips.sh <输出目录>   例: <STUDIO_ROOT>/CTS/remotion-assets
set -e
OUT="${1:?给输出目录}"; mkdir -p "$OUT/clips" "$OUT/music"
W=/Users/raydeng/Projects/chinatravel/public/blog                       # 官网团照（只读）
F=/Users/raydeng/Library/CloudStorage/Dropbox/MagicLab_Studio/CTS/footage/stock
C=/Users/raydeng/Projects/cts-remotion/public/clips
fit() { ffmpeg -nostdin -y -v error -loop 1 -i "$1" -filter_complex "[0:v]split[a][b];[a]scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,boxblur=60:6,eq=brightness=-0.08[bg];[b]scale=2160:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,zoompan=z='1+0.08*on/6/30':d=180:x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':s=1080x1920:fps=30,format=yuv420p" -t 6 -c:v libx264 -crf 18 -an "$OUT/clips/$2.mp4"; }
seg() { ffmpeg -nostdin -y -v error -ss "$2" -i "$1" -t 4 -an -c:v libx264 -crf 18 -pix_fmt yuv420p "$OUT/clips/$3.mp4"; }
fit "$W/group-shanghai-bund-skyline.jpg" hook_bundgroup
fit "$W/group-walking-shanghai-lane.jpg" item3_walklane
seg "$F/shanghai_35473020.mp4" 2.0 item1_skylineday
seg "$F/v_watertown_27958758.mp4" 3.0 item2_watertown
seg "$F/v_bund_36546365.mp4" 2.0 item3_bund
seg "$F/v_nanjingroad_35646223.mp4" 3.0 item5_nanjingroad
cp "$C/s1_shanghai_aerial_night.mp4" "$OUT/clips/item2_aerialnight.mp4"
ffmpeg -nostdin -y -v error -stream_loop 3 -i "$C/s7b_shanghai_day.mp4" -t 8 -c:v libx264 -crf 18 -an "$OUT/clips/price_shanghaiday.mp4"
ffmpeg -nostdin -y -v error -i "/Users/raydeng/Library/CloudStorage/Dropbox/MagicLab_Studio/Music/Building Momentum.m4a" -t 40 -c:a libmp3lame -q:a 2 "$OUT/music/momentum.mp3"
echo "done -> $OUT   （logo 由出片机从品牌包 watermark.png 自取，不用放）"
