# StreamForge implementation status

The first deliverable is a working local streaming system, following the roadmap's instruction to verify media before adding distributed infrastructure.

| Original phase | Status in this repository |
|---|---|
| Repository + capture/encode foundation | C++17 sender, test/camera capture, H.264/Opus, reproducible encoding throughput runner |
| WebRTC to browser | Implemented; browser and native publisher integration tests |
| Go signaling + STUN/TURN | Signaling tested locally; cross-network configuration supplied but not field-tested |
| One-to-many SFU | Go/Pion implementation; 10-, 50-, and 100-viewer native-source functional runs completed. C++ SFU deferred |
| QoE telemetry | Measured browser stats, CSV, Prometheus, provisioned Grafana |
| Adaptive controller | Browser sender parameters, injected profile + RTCP + viewer telemetry, recovery hysteresis |
| Network simulator | Actual SFU packet impairment; optional Linux netem script |
| NVIDIA NVENC/NVDEC | Benchmark runner accepts nvh264enc; hardware integration and validation pending |
| AV1 benchmark | Browser codec preference when supported; controlled VMAF/PSNR comparison pending |
| Access + persistence | Optional operator authentication, protected management APIs, signed per-room viewer capabilities, and persistent completed-session JSONL history implemented; user accounts and tenant roles remain pending |
| Kafka / Redis / PostgreSQL | Not implemented; active rooms remain in memory and completed history currently uses local JSONL |
| Airflow batch workflows | Not implemented; benchmark runner is ready to be invoked by a future DAG |
| TensorRT / DeepStream AI | Not implemented; no fake detections or GPU metrics |
| LL-HLS/CMAF broadcast | Not implemented |
| Distributed control plane / Kubernetes | Not implemented |
| Final load and quality experiments | Short 50/100-viewer functional checks and CPU throughput measurements completed; sustained throughput, latency, and quality studies remain pending |

Next engineering priorities: quality layers/simulcast and per-viewer selection; native sender runtime adaptation; real cross-network TURN validation; sustained soak/load and glass-to-glass latency tests; then PostgreSQL-backed accounts/audit history and NVIDIA hardware measurements. Codec quality claims require identical clips and comparable quality settings. No benchmark result is claimed for hardware absent from this machine.
