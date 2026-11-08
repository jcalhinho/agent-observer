#!/usr/bin/env bash
# Turns a screen recording of the app into the files the README and the launch posts use.
#   bash docs/media/make-demo.sh recording.mov [start] [length]
#     start, length: seconds to keep (default 0 and 60)
# Writes, next to this script:
#   demo.mp4  H.264, 1280 px wide, no sound: upload it to a GitHub issue or the README editor to embed it
#   demo.gif  960 px wide, 10 frames a second: the README animation (keep it under ~8 MB)
# Needs ffmpeg (brew install ffmpeg).
set -euo pipefail

input="${1:?usage: make-demo.sh <recording> [start seconds] [length seconds]}"
start="${2:-0}"
length="${3:-60}"
[[ -f "$input" ]] || { echo "not a file: $input" >&2; exit 2; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed (brew install ffmpeg)" >&2; exit 2; }
out="$(cd "$(dirname "$0")" && pwd)"
palette="$(mktemp "${TMPDIR:-/tmp}/demo-palette.XXXXXX")"
trap 'rm -f "$palette"' EXIT

ffmpeg -v error -y -ss "$start" -t "$length" -i "$input" -an \
  -vf "fps=30,scale=1280:-2:flags=lanczos" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -movflags +faststart "$out/demo.mp4"
ffmpeg -v error -y -ss "$start" -t "$length" -i "$input" \
  -vf "fps=10,scale=960:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" -f image2 -update 1 "$palette"
ffmpeg -v error -y -ss "$start" -t "$length" -i "$input" -i "$palette" \
  -lavfi "fps=10,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 "$out/demo.gif"
ls -lh "$out/demo.mp4" "$out/demo.gif"
