#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GST_PLUGIN_PATH="$PWD/media-engine/build/plugins${GST_PLUGIN_PATH:+:$GST_PLUGIN_PATH}"
exec media-engine/build/streamforge-media "$@"
