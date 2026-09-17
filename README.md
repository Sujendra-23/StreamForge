# StreamForge

**Live streaming, engineered from capture to playback.**

StreamForge is a real-time media engineering project that captures video and audio, sends them over WebRTC to a selective forwarding unit (SFU), and distributes the encoded media to multiple browser viewers. It combines a React studio, a native C++/GStreamer sender, Go signaling and RTP forwarding, measured quality-of-experience telemetry, and an interactive network experimentation lab.

The centerpiece is a real network-degradation experiment: start a stream, open viewers, inject packet loss / delay / a bandwidth ceiling at the SFU, and observe the browser publisher reduce quality and recover as conditions improve.

**Verified locally:** native H.264 + Opus streaming to **10 simultaneous browser viewers**, browser publishing to **3 viewers**, actual packet impairment and quality recovery, and **zero automated WCAG A/AA violations** across the six idle desktop dashboard pages.

## Contents

- [What StreamForge does](#what-streamforge-does)
- [Tech stack](#tech-stack)
- [Run locally](#run-locally)
- [Native C++ sender](#native-c-sender)
- [Implemented features](#what-works)
- [Architecture](#architecture)
- [Configuration and deployment](#configuration-and-deployment)
- [Previous test results](#previous-test-results)
- [Measured encoding results](#measured-encoding-results)
- [Reproduce the checks](#checks)
- [Limitations and roadmap](#limitations-and-roadmap)

## What StreamForge does

| Surface | What you can do |
|---|---|
| **Studio** | Choose a test source, camera, or screen; configure codec and quality; enable microphone capture; start/stop a broadcast; copy a viewer link; inspect and export measured telemetry. |
| **Viewer** | Watch live WebRTC video/audio, unmute, enter full screen, inspect receive-side statistics, and reconnect after a disconnect. |
| **Live streams** | Discover active local broadcasts and open their viewers. |
| **Network Lab** | Apply actual SFU packet loss, delay, jitter, and bandwidth constraints; observe adaptive quality changes; restore healthy conditions. |
| **Operations** | See active streams, viewer counts, received media, impaired packets, node status, and the Prometheus endpoint. |
| **Architecture / Settings** | Inspect the implemented pipeline, deferred capabilities, and current server/ICE configuration. |

The animated landscape is a **real canvas-captured test video**, not prerecorded footage or a fake stream. Bitrate, frame rate, RTT, jitter, loss, and encode/decode processing time come from WebRTC statistics. Unsupported GPU/AI capabilities are identified as roadmap items.

## Tech stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | **React 19, TypeScript 7, Vite 8** | Studio, viewer, lab, operations UI, and production build. |
| Interface | **CSS, Lucide React, Manrope / DM Sans / IBM Plex Mono** | Responsive layout, icons, typography, focus states, and reduced-motion support. |
| Browser media | **WebRTC, MediaDevices, Canvas Capture, WebSocket** | Camera/microphone/screen/test capture, peer connections, SDP/ICE exchange, playback, `getStats()`, and sender parameter changes. |
| Backend | **Go 1.27, net/http, coder/websocket** | HTTP APIs, signaling, room ownership/lifecycle, origin checks, and configuration. |
| SFU | **Pion WebRTC v4, RTP / RTCP** | One-to-many encoded packet forwarding, NACK handling, and PLI keyframe requests. |
| Native media | **C++17, GStreamer 1.28, webrtcbin, x264, Opus** | Synthetic or webcam/microphone capture, native encoding, RTP packetization, and WebRTC publishing. |
| Native build/signaling | **CMake, pkg-config, GLib, libsoup 3, JSON-GLib, libnice** | Native dependency discovery, event loop, WebSocket/JSON signaling, and ICE transport. |
| Codecs | **H.264 + Opus**; browser **VP8 / AV1** where supported | Native H.264/Opus; browser video codec preference with capability-dependent AV1. |
| Connectivity/security | **ICE, STUN, TURN, DTLS-SRTP** | Peer discovery, optional NAT traversal, encrypted media; coturn configuration and expiring TURN credentials. |
| Adaptation | **TypeScript heuristic controller** | Bitrate/FPS/resolution targets, immediate degradation, and recovery hysteresis using RTCP, viewer QoE, and the injected profile. |
| Network experiments | **Go RTP impairment queue**, optional **Linux tc/netem** | Per-room packet pacing/drop/delay in the app; separately invoked OS-level Linux experiments. |
| Observability | **Prometheus, Grafana, CSV export** | Metrics exposition, optional provisioned dashboards, and browser session exports. |
| Testing | **Go testing + race detector, Vitest, Playwright Chromium, axe-core** | Backend/controller tests, real streaming integration, responsive UI, and accessibility scans. |
| Benchmarking | **Python 3, GStreamer CLI** | Repeatable offline encoding measurements and JSON reports. |
| Delivery | **Docker / Docker Compose, GitHub Actions** | Container/optional service configuration and automated validation workflow. |

Exact JavaScript dependencies are locked in [`package-lock.json`](package-lock.json); Go modules in [`go.mod`](go.mod) and [`go.sum`](go.sum). GStreamer 1.28.7 is the locally tested version; the native CMake project requires GStreamer 1.22 or newer.

**Not part of the implemented runtime yet:** CUDA, NVENC/NVDEC integration, TensorRT/DeepStream, Kafka, Redis, PostgreSQL, Airflow, S3, LL-HLS/CMAF, gRPC regional scheduling, and Kubernetes. See [the roadmap](docs/roadmap.md).

**This repository implements the local MVP.** NVIDIA inference, distributed scheduling, Kafka, Airflow, and LL-HLS remain later roadmap stages. The UI never substitutes simulated telemetry for real measurements.

## Run locally

Requires **Node.js 24+** and **Go 1.27+**.

```bash
git clone git@github.com:Sujendra-23/StreamForge.git
cd StreamForge
npm ci
npm run dev
```

HTTPS clone alternative: `git clone https://github.com/Sujendra-23/StreamForge.git`.

The browser-only path does **not** require GStreamer or Docker. Install native media dependencies only when using the C++ sender or encoding benchmark.

Open **http://127.0.0.1:5173**. The Go signaling/SFU server runs on `127.0.0.1:8080`. The development script builds the Go binary once and starts both services. Restart it after Go changes; React changes hot reload.

1. In **Studio**, keep the default **Test source** and click **Go live**. The animated canvas is captured and transmitted as real video; it does not require camera permissions.
2. Click **Open viewer** beside **Copy viewer link**, or open the copied URL in other tabs. Each viewer receives the publisher through the SFU, without transcoding.
3. Open **Network lab**, choose **On the edge**, then **Apply conditions**. The SFU actually drops, delays, and paces RTP packets. The browser publisher lowers bitrate, frame rate, and resolution targets.
4. Click **Restore network** and watch the controller recover one quality level after three healthy samples. Measured output can differ from the target because browser congestion control also operates.
5. Export measured telemetry as CSV. Check **Operations**, `/metrics`, or the optional Grafana dashboard.

Camera and screen capture are selectable before starting. Enable the microphone before going live to include Opus audio. The live microphone button mutes/unmutes an existing track. Device permissions are requested only when starting a stream. Viewer audio starts muted to satisfy browser autoplay policies.

## Native C++ sender

The native sender captures webcam + microphone (`--camera`) or generates video + a quiet sine tone (`--test`). Both publish H.264 + Opus via GStreamer `webrtcbin` into the same Go SFU.

macOS:

```bash
brew install cmake pkgconf gstreamer json-glib
npm run build:native
npm run native -- --test --room native-demo
# Webcam and microphone instead:
npm run native -- --camera --room webcam --width 1920 --height 1080 --fps 30
```

Linux (Debian/Ubuntu):

```bash
sudo apt-get install cmake pkg-config libgstreamer1.0-dev \
  libgstreamer-plugins-base1.0-dev libgstreamer-plugins-bad1.0-dev \
  libsoup-3.0-dev libjson-glib-dev \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly gstreamer1.0-nice
npm run build:native
npm run native -- --test --room native-demo
```

View at **http://127.0.0.1:5173/watch/native-demo**. The stream also appears under **Live streams**.

If the installed GStreamer lacks `nicesrc`, the build helper downloads checksum-verified libnice 0.1.24 sources and builds only its GStreamer ICE plugin into `media-engine/build/plugins`. `npm run native` sets the plugin search path. It does not modify system plugin directories. Plugin source and licenses remain in the ignored build directory. On machines with multiple GStreamer installations (e.g. Conda + Homebrew), ensure `pkg-config` and `gst-launch-1.0` use the same prefix.

Native options:

```text
--url ws://127.0.0.1:8080/ws
--room native-demo
--title "My native stream"
--width 1280 --height 720 --fps 30 --bitrate 2500
--stun stun://host:3478
--turn turn://username:password@host:3478
```

The native sender currently uses fixed x264 quality. The adaptive controller and Network Lab publisher controls are implemented in the browser Studio; they do not remotely configure the native process.

## What works

- React/TypeScript Studio, live stream directory, viewer, Network Lab, operations, architecture, and settings.
- Browser canvas/camera/screen capture, optional microphone, H.264/VP8 preference and browser AV1 when supported, remote playback, full screen, viewer links, CSV telemetry.
- Go WebSocket publish/subscribe, SDP, trickle ICE, origin checks, room ownership, publisher teardown, bounded room/viewer capacity.
- One-to-many RTP forwarding via Pion, DTLS-SRTP, NACK feedback, PLI keyframe requests, and audio/video tracks.
- C++17 GStreamer H.264 + Opus publisher. Tested with synthetic audio/video.
- Bounded per-room RTP impairment queue: bandwidth, added delay, jitter, and packet loss.
- Browser adaptive controller with immediate degradation and hysteresis for recovery; uses measured RTCP plus the injected profile and viewer telemetry.
- Real `getStats()` telemetry, Prometheus endpoint, Grafana provisioning.
- STUN/TURN configuration with time-limited TURN credentials, optional coturn service, Docker configuration, CI, integration tests, offline encoding benchmarks.

## Architecture

```text
Browser Studio ─── WebRTC (H.264/VP8/AV1 + optional Opus) ───┐
                                                          ▼
C++ GStreamer ─── WebRTC (H.264 + Opus) ─── Go/Pion SFU ─── multiple browser viewers
                                                │
                                    RTP impairment queue
                                                │
                            /metrics ─── Prometheus ─── Grafana

React and C++ ─── WebSocket SDP / ICE ─── Go signaling (same process as SFU)
```

**Intentional roadmap adjustment:** signaling and SFU forwarding share one Go process using Pion. Capture/encoding remain C++. Implementing a second C++ peer-connection stack before verifying the full media path would add substantial complexity. The protocol and UI can be retained if a C++ forwarding implementation is introduced later.

| Directory | Responsibility |
|---|---|
| `web/` | React UI, WebRTC client, telemetry, adaptive controller |
| `media-engine/` | C++ GStreamer native publisher |
| `signaling/` | Go HTTP/WebSocket API, ownership, ICE config, metrics |
| `sfu/` | RTP fan-out and packet impairment |
| `cmd/streamforge/` | Server entry point |
| `telemetry/` | Prometheus / Grafana configuration |
| `benchmarks/` | Measured encoding throughput runner |
| `infra/` | Container build configuration |
| `tests/` | Browser / SFU / native integration tests |
| `docs/` | Protocol, deployment, validation, remaining roadmap |

## Configuration and deployment

The default local server listens on loopback and stores rooms in memory. It does not require a database or an account.

| Setting | Purpose |
|---|---|
| `ADDR` | Go HTTP listener; defaults to `127.0.0.1:8080`. |
| `WEB_DIR` | Built frontend directory; defaults to `web/dist`. |
| `ALLOWED_ORIGINS` | Allowed browser hostnames for WebSocket connections. |
| `STUN_URL` | Optional STUN server for ICE discovery. |
| `TURN_URL`, `TURN_SECRET` | Optional TURN endpoint and shared secret for expiring credentials. |
| `RTC_PUBLIC_IP` | Reachable IP advertised by the SFU when deployed behind NAT. |
| `RTC_UDP_MIN`, `RTC_UDP_MAX` | Optional fixed media UDP port range. |

See [`.env.example`](.env.example). The local Go process reads **exported environment variables**; Docker Compose reads `.env` for interpolation. Do not commit real credentials.

For a production frontend build served directly by Go:

```bash
npm run build
npm start
# http://127.0.0.1:8080
```

For the supplied Docker configuration, with Docker running:

```bash
cp .env.example .env
docker compose up --build
# http://127.0.0.1:8080

# Optional Prometheus and Grafana:
docker compose --profile observability up --build
# Prometheus: http://127.0.0.1:9090
# Grafana:    http://127.0.0.1:3000
```

Stop a conflicting local server before starting the container on port 8080. The local Grafana login is `admin` with the configured `GRAFANA_PASSWORD` (example default: `streamforge-local`). Container runtime and Grafana were **not run** during the recorded validation because the Docker daemon was unavailable; Compose configuration validation passed.

Camera/microphone access outside localhost requires HTTPS. Cross-network WebRTC also needs reachable ICE candidates or a working TURN relay; see [deployment instructions](docs/deployment.md) for ports, TLS, TURN, and the local development security model.

## Previous test results

These are **previously executed local results**, recorded on **September 17, 2026**, not claims that GitHub Actions has already passed. Environment: **macOS arm64, Node.js 26.8.1, Go 1.27.0, GStreamer 1.28.7, Playwright Chromium**.

| Check | Recorded result | What it verified |
|---|---|---|
| `npm run check` | **Passed** | TypeScript compilation and `go vet`. |
| `npm run build` | **Passed** | Production React/Vite build. |
| Vitest via `npm test` | **3 tests passed** | Immediate degradation; three healthy samples before recovery; quality ceiling; intermittent recovery; observed RTT/loss inputs. |
| Go tests via `npm test` | **6 tests passed** | Network validation, viewer capacity/reclamation, packet accounting, room ownership/cleanup, origin rejection, and metrics. |
| `go test -race ./...` | **Passed** | Both tested Go packages passed with the race detector; the command entry point has no unit tests. |
| `npm run test:e2e` | **3 passed, 1 intentionally skipped; 11.7 s** | Browser source to three viewers, actual RTP impairment, lower quality target, recovery, cleanup; synthetic camera/microphone tracks; mobile navigation/layout and offline viewer. The native test is skipped in this default run. |
| `npm run test:native` | **1 passed; 4.0 s suite / 3.7 s test** | C++ H.264 + Opus through the SFU to **10 simultaneous viewers**. Each had 1280-pixel-wide video, one audio track, and **more than 20 decoded frames**. |
| `npm run test:a11y` | **0 violations across 6 pages** | axe WCAG 2 A/AA checks on idle desktop Studio, Network Lab, Live streams, Operations, Architecture, and Settings. |
| Native CMake build | **Passed** | C++17 sender compiled and linked against GStreamer, libsoup, and JSON-GLib. |
| H.264 decode smoke check | **Passed** | Generated 720p H.264 parsed and decoded through GStreamer to `fakesink`. |
| `docker compose config --quiet` | **Passed** | Compose configuration validation only, not container execution. |

The browser broadcast test uses the severe profile **2 Mbps / 120 ms added one-way delay / 30 ms jitter / 8% packet loss**, checks that the SFU's actual dropped-packet counter increases, verifies a **720p target**, restores healthy conditions, and checks quality recovery. The native test verifies video decoding and audio-track presence; it is not a subjective audio listening test.

Camera/microphone tests used Chromium's **synthetic devices**, not the physical webcam/microphone. Ten-viewer testing is a short functional test, not a sustained performance/load guarantee. Accessibility results apply to the scanned states and are not a full accessibility certification. Timing can vary by machine and load.

Test sources: [`tests/streaming.spec.ts`](tests/streaming.spec.ts), [`tests/native.spec.ts`](tests/native.spec.ts), [`web/src/lib/adaptive.test.ts`](web/src/lib/adaptive.test.ts), [`sfu/room_test.go`](sfu/room_test.go), [`signaling/server_test.go`](signaling/server_test.go). See [validation notes](docs/validation.md) for untested scenarios.

## Measured encoding results

A previously executed x264 smoke benchmark used **90 frames per configuration**, the **SMPTE test pattern**, **5,000 kbps target bitrate**, `veryfast` preset, and `zerolatency` tuning. It ran offline on the same macOS arm64 environment at **2026-09-17 19:29:12 UTC**.

| Source configuration | Frames | Wall time | Offline throughput | CPU time | Output bitrate |
|---|---:|---:|---:|---:|---:|
| 1280 × 720 / 30 fps | 90 | 0.455 s | 197.65 fps | 0.566 s | 5.463 Mbps |
| 1920 × 1080 / 30 fps | 90 | 0.406 s | 221.75 fps | 1.055 s | 5.427 Mbps |
| 1920 × 1080 / 60 fps | 90 | 0.376 s | 239.63 fps | 0.987 s | 5.230 Mbps |

[View the preserved raw JSON report](docs/results/2026-09-17-x264.json). No values in this table are estimates or invented GPU comparisons.

**Interpretation:** offline throughput is processed frames divided by pipeline wall time, including startup. It is **not** the live source frame rate, per-frame encoding latency, or end-to-end streaming latency. CPU time can exceed wall time because encoding is multithreaded. These short runs are affected by warmup and scheduling; the higher measured throughput at larger configurations should not be interpreted as a scaling claim. They do not measure codec quality, VMAF, PSNR, power, or AV1/NVIDIA performance.

Reproduce the original sample:

```bash
python3 benchmarks/encode.py --frames 90
```

For a longer run:

```bash
python3 benchmarks/encode.py --frames 300
```

The runner writes `.h264` outputs and a JSON report under the ignored `benchmarks/results/` directory. The checked-in JSON above preserves the original measurement. `--encoder nvh264` selects the NVIDIA plugin on a compatible host, but that path has not been hardware-validated here.

## Checks

```bash
npm run check             # TypeScript + go vet
npm run build             # Production frontend
npm test                  # Adaptive controller + Go tests
go test -race ./...      # Room lifecycle, validation, packet accounting, races
npx playwright install chromium
npm run test:e2e          # Real browser streaming, loss/recovery, capture, responsive UI
npm run test:a11y         # Six-page axe scan (requires npm run dev)
npm run build:native
npm run test:native       # C++ H.264/Opus to TEN Chromium viewers
python3 benchmarks/encode.py --frames 300
```

`npm run test:native` requires a native build. It launches a temporary native publisher and verifies H.264 dimensions, an audio track, and at least 20 decoded video frames for each of ten viewers. Tests release their rooms afterward.

## Limitations and roadmap

- **Local MVP:** one Go signaling/SFU process, in-memory rooms, no user accounts, persistent history, or public multi-tenant authorization. Origin checks are not a substitute for authentication.
- **Forwarding implementation:** the current SFU is Go/Pion; a C++ SFU from the original roadmap is deferred. Native capture and encoding are C++.
- **Adaptation:** one shared upstream quality level; there is no simulcast/per-viewer layer selection. A constrained viewer can affect everybody. Native x264 quality is fixed for the process lifetime.
- **Impairment:** the built-in lab operates on RTP before fan-out, not on the entire operating-system network. The optional Linux netem script was not exercised here.
- **Connectivity:** same-machine transport was tested; different-network STUN/TURN traversal was not. Deployment configuration does not constitute a production deployment.
- **Not yet measured:** sustained 50/100-viewer load, real-device capture, end-to-end glass-to-glass latency, hardware GPU usage/encoding, inference overhead, or AV1 quality comparisons.
- **Future stages:** NVIDIA encoding/decoding, controlled AV1 benchmarking, Kafka/Redis/PostgreSQL, Airflow batch analytics, TensorRT object detection, LL-HLS broadcast, and regional scheduling/failover.

See [deployment](docs/deployment.md), [signaling protocol](docs/protocol.md), [validation](docs/validation.md), and [remaining roadmap](docs/roadmap.md).
