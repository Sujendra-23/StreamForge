#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cmake -S media-engine -B media-engine/build -DCMAKE_BUILD_TYPE=Release
cmake --build media-engine/build --parallel
# Homebrew's libnice bottle omits its GStreamer plugin. Build only that plugin,
# against the installed libnice, in this project's ignored build directory.
if ! gst-inspect-1.0 nicesrc >/dev/null 2>&1; then
  python3 scripts/build-nice-plugin.py
fi
