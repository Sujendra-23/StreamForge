# Reproducible media measurements

`python3 benchmarks/encode.py --frames 300` measures x264 CPU encoding of an identical SMPTE test pattern at 720p30, 1080p30, and 1080p60. It writes Annex B H.264 and JSON to `results/`.

The JSON includes wall time, CPU seconds, achieved **offline throughput**, bytes, and bitrate over media duration. It includes pipeline startup and is not per-frame encode latency. The UI measures encode/decode processing time separately from WebRTC `getStats()` interval counters. Neither metric is end-to-end glass-to-glass latency.

`--encoder nvh264` selects GStreamer's NVIDIA encoder if installed on a compatible GPU host. That path has not been hardware-validated here. Never compare codec quality using throughput numbers alone.

Decode a produced file:

```bash
gst-launch-1.0 filesrc location=benchmarks/results/x264-1280x720-30.h264 ! h264parse ! avdec_h264 ! videoconvert ! autovideosink
```

Browser session measurements can be exported from Studio or Network Lab as CSV.
