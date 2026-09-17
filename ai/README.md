# AI / NVIDIA stage

TensorRT inference and CUDA frame processing are deferred until an NVIDIA host is available. There is no simulated detection or GPU utilization in this build. The intended path is NVDEC → CUDA memory → TensorRT detection/tracking → overlay → NVENC → WebRTC. Measure added per-frame and end-to-end latency before presenting results.
