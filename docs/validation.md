# Validation notes

Validated locally on macOS arm64 with Node 26.8.1, Go 1.27.0, GStreamer 1.28.7, and Playwright Chromium.

- Production React build and strict TypeScript compilation.
- Go unit tests with the race detector: network bounds, viewer limit/reclamation, packet forwarding/drop accounting, room ownership/cleanup, origin rejection, metrics.
- Adaptive controller tests: immediate degradation, three-sample hysteresis, quality ceiling, noisy recovery, measured RTT/loss inputs.
- Browser publisher through the actual SFU to three viewers; video reception, viewer counts, severe impairment, quality reduction/recovery, room cleanup.
- Camera + microphone capture with Chromium's **synthetic test devices**, yielding both video and audio RTP. Physical camera/microphone permission and hardware capture were not exercised.
- Native C++ synthetic H.264 + Opus sender through the actual SFU to **ten simultaneous browser viewers**, each with 1280-pixel video width, one audio track, and more than 20 decoded frames.
- Mobile layout with no horizontal overflow, navigation, empty directory, and offline viewer.
- Automated axe WCAG 2 A/AA scan: zero violations across Studio, Network Lab, Live streams, Operations, Architecture, and Settings (idle desktop states; not a full accessibility certification).
- Actual CPU x264 throughput run at 720p30, 1080p30, and 1080p60 (90 frames each). Generated media and working reports are in the ignored `benchmarks/results/` directory. The original JSON report is preserved at [`results/2026-09-17-x264.json`](results/2026-09-17-x264.json). These short synthetic-source runs are smoke measurements, not codec quality or latency studies.

Not validated here: different-network NAT traversal, physical camera/mic capture, NVIDIA hardware, Linux netem, Docker service runtime (Docker daemon unavailable), Grafana runtime, 50/100-viewer load, sustained soak, end-to-end glass-to-glass latency, AV1 quality comparison, or production security.
