#!/usr/bin/env bash
# Atmosphere sample self-check: 9-frame grid + luma at cover time + loudness + duration. Read-only on the mp4.
# Usage: self-check.sh <final.mp4> <out-dir>
set -euo pipefail
V="$1"; O="$2"; mkdir -p "$O"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V")
echo "duration_s=$DUR"
ffprobe -v error -show_entries stream=codec_type,width,height -of csv=p=0 "$V" | tr '\n' ' '; echo
# 9 evenly spaced frames, first at 0.0s, last at duration-0.1s
python3 - "$V" "$O" "$DUR" <<'PY'
import subprocess,sys
v,o,d=sys.argv[1],sys.argv[2],float(sys.argv[3])
ts=[0.0]+[d*i/8 for i in range(1,8)]+[d-0.1]
for i,t in enumerate(ts):
    subprocess.run(['ffmpeg','-v','error','-y','-ss',f'{t:.2f}','-i',v,'-frames:v','1','-vf','scale=360:-1',f'{o}/f{i}.jpg'],check=True)
print('frame times:',[round(t,2) for t in ts])
PY
ffmpeg -v error -y -i "$O/f0.jpg" -i "$O/f1.jpg" -i "$O/f2.jpg" -i "$O/f3.jpg" -i "$O/f4.jpg" -i "$O/f5.jpg" -i "$O/f6.jpg" -i "$O/f7.jpg" -i "$O/f8.jpg" \
  -filter_complex "[0][1][2]hstack=inputs=3[a];[3][4][5]hstack=inputs=3[b];[6][7][8]hstack=inputs=3[c];[a][b][c]vstack=inputs=3" "$O/grid9.jpg"
# cover-time brightness (the factory's cover check samples 0.5s; must be >= 18 mean luma, range >= 20)
python3 - "$V" <<'PY'
import subprocess,sys
v=sys.argv[1]
b=subprocess.check_output(['ffmpeg','-v','error','-ss','0.5','-i',v,'-frames:v','1','-vf','scale=32:32:flags=area,format=gray','-f','rawvideo','-pix_fmt','gray','pipe:1'])
vals=list(b); print('cover@0.5s mean_luma=%.1f range=%d'%(sum(vals)/len(vals),max(vals)-min(vals)))
PY
ffmpeg -nostats -i "$V" -af ebur128 -f null - 2>&1 | grep -A1 "Integrated" | tail -1
echo "grid: $O/grid9.jpg  -> 逐格目视核对：地点是不是外滩/黄浦江、有无人像、有无文字/价格、Logo 完整、第0帧不黑、末帧淡出。"
