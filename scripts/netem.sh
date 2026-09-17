#!/usr/bin/env bash
# Linux-only, optional OS-level impairment. Never run automatically.
set -euo pipefail
if [[ "$#" -lt 2 ]]; then
  echo "Usage: sudo $0 INTERFACE apply [delay_ms jitter_ms loss_percent rate_mbit] | INTERFACE clear" >&2
  exit 2
fi
iface="$1"
[[ "$iface" =~ ^[a-zA-Z0-9_.:-]+$ ]] || { echo 'Invalid interface' >&2; exit 2; }
case "$2" in
  apply)
    delay="${3:-120}"; jitter="${4:-30}"; loss="${5:-8}"; rate="${6:-2}"
    for number in "$delay" "$jitter" "$loss" "$rate"; do
      [[ "$number" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo 'Expected numeric conditions' >&2; exit 2; }
    done
    tc qdisc replace dev "$iface" root netem delay "${delay}ms" "${jitter}ms" loss "${loss}%" rate "${rate}mbit"
    ;;
  clear) tc qdisc del dev "$iface" root ;;
  *) echo 'Expected apply or clear' >&2; exit 2 ;;
esac
