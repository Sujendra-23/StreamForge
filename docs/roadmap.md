# StreamForge implementation status

The first deliverable is a working local streaming system, following the roadmap's instruction to verify media before adding distributed infrastructure.

| Original phase | Status in this repository |
|---|---|
| Repository + capture/encode foundation | C++17 sender, test/camera capture, H.264/Opus, reproducible encoding throughput runner |
| WebRTC to browser | Implemented; browser and native publisher integration tests |
| Go signaling + STUN/TURN | Signaling tested locally; cross-network configuration supplied but not field-tested |
| One-to-many SFU | Go/Pion implementation; ten native-source browser viewers tested. C++ SFU deferred |
| QoE telemetry | Measured browser stats, CSV, Prometheus, provisioned Grafana |
| Adaptive controller | Browser sender parameters, injected profile + RTCP + viewer telemetry, recovery hysteresis |
| Network simulator | Actual SFU packet impairment; optional Linux netem script |
| NVIDIA NVENC/NVDEC | Benchmark runner accepts nvh264enc; hardware integration and validation pending |
| AV1 benchmark | Browser codec preference when supported; controlled VMAF/PSNR comparison pending |
| Kafka / Redis / PostgreSQL | Not implemented; in-memory rooms only |
| Airflow batch workflows | Not implemented; benchmark runner is ready to be invoked by a future DAG |
| TensorRT / DeepStream AI | Not implemented; no fake detections or GPU metrics |
| LL-HLS/CMAF broadcast | Not implemented |
| Distributed control plane / Kubernetes | Not implemented |
| Final load and quality experiments | Local functional checks and CPU throughput measurements only |

Next engineering priorities: real cross-network TURN validation; sustained soak/load tests; server-enforced authentication and room access; quality layers/simulcast; native sender adaptation; then NVIDIA hardware measurements. Codec quality claims require identical clips and comparable quality settings. No benchmark result is claimed for hardware absent from this machine.
