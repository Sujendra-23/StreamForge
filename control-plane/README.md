# Control plane

The local MVP's room ownership, capacity checks, ICE configuration, and lifecycle live in `../signaling/server.go`. The SFU shares that process. Regional scheduling, gRPC heartbeats, Redis assignments, and failover are future work; see `../docs/roadmap.md`.
