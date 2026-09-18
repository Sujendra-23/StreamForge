# Deployment

## Local development model

The default server binds only to `127.0.0.1`. Active rooms are ephemeral. Set `STREAMFORGE_AUTH_SECRET` to require an operator token for publishing and management APIs and to issue signed, room-instance-specific viewer links. Set `STREAMFORGE_HISTORY_PATH` to append completed session summaries to JSONL and restore them after restart. Docker Compose enables history persistence automatically. Only the socket that created a room can send its network commands.

The optional token protects a single operator and its viewer capabilities; it is not an account system or tenant-role model. A public multi-tenant service still requires user identity, per-resource authorization, rate limits, trusted telemetry, TLS termination, a shared database, secret rotation, and audit policy. The current room cap is 32, with up to 100 viewer reservations per room; these are limits, not capacity guarantees.

## Environment

| Variable | Default / purpose |
|---|---|
| `ADDR` | `127.0.0.1:8080` |
| `WEB_DIR` | `web/dist` |
| `ALLOWED_ORIGINS` | localhost and 127.0.0.1 on ports 5173/8080; comma-separated host patterns |
| `STUN_URL` | Optional, e.g. `stun:stun.l.google.com:19302` |
| `TURN_URL` | Optional, e.g. `turn:YOUR_HOST:3478?transport=udp` |
| `TURN_SECRET` | Shared HMAC secret with coturn; never sent to the client |
| `RTC_PUBLIC_IP` | Optional public address advertised for SFU host candidates |
| `RTC_UDP_MIN/MAX` | Optional UDP range, e.g. 50000–50050 |
| `STREAMFORGE_AUTH_SECRET` | Optional operator secret used for publisher/API authorization and HMAC-signed viewer capabilities |
| `STREAMFORGE_HISTORY_PATH` | Optional completed-session JSONL path; Compose uses `/data/history.jsonl` |
| `GRAFANA_PASSWORD` | Compose-only local Grafana password |

The frontend gets ICE servers from `/api/config`. TURN credentials are HMAC-SHA1 credentials expiring after one hour. A new connection obtains fresh credentials. A long-running TURN session may need reconnection after its credentials expire. Native sender ICE URIs are passed with `--stun` / `--turn` separately.

The Go program reads exported environment variables. It does not implicitly load `.env`. Docker Compose reads `.env` for interpolation.

When authentication is enabled, enter the operator secret in the dashboard's Settings page. It is held in browser session storage and sent as a bearer token to management APIs and as the initial publisher WebSocket credential. Native publishers read `STREAMFORGE_AUTH_SECRET` or use `--token`. Viewer URLs contain a room-scoped signed capability and never contain the operator secret.

## Docker

```bash
cp .env.example .env
# Stop the local server if it occupies port 8080.
docker compose up --build
# http://127.0.0.1:8080
```

For optional monitoring:

```bash
docker compose --profile observability up --build
# Grafana http://127.0.0.1:3000 (admin / GRAFANA_PASSWORD)
# Prometheus http://127.0.0.1:9090
```

The dashboard is provisioned automatically under the StreamForge folder. Metric time series appear once browser telemetry is flowing. Native publishers currently contribute RTP traffic counters; browser viewers still contribute receive-side QoE.

The container advertises `RTC_PUBLIC_IP` (loopback by default) and publishes a matching UDP range. When accessed from another host, set this address to an address reachable by that host and adjust the HTTP binding/origin allowlist. Docker Desktop UDP reachability varies; native Go execution avoids that extra NAT layer for initial tests.

## Different networks

1. Run the SFU on a reachable host. Set `RTC_PUBLIC_IP` and a fixed UDP port range.
2. Allow that UDP range through the host firewall and router.
3. Put HTTPS and WSS in front of the HTTP server. Browser capture needs HTTPS outside localhost. A reverse proxy carries signaling only; RTP still needs UDP reachability or TURN.
4. Set the exact browser hostname in `ALLOWED_ORIGINS`.
5. Configure a reachable TURN server. If using the optional coturn profile, supply a random `TURN_SECRET`, matching `TURN_URL`, and the correct external IP. Open UDP/TCP 3478 and relay UDP 49160–49200.
6. Test from a second network. Inspect the chosen ICE pair and verify audio/video reception before declaring NAT traversal validated.

The example coturn profile exposes authenticated UDP/TCP TURN without TLS. Use a configured TURN TLS endpoint for environments that restrict UDP. Cross-network connectivity and container deployment have not been validated on this workstation.

## Network Lab vs Linux netem

The UI's lab is application-level RTP impairment in the SFU. It works on macOS and Linux without root, affects one room, and leaves WebSocket signaling untouched. It is an ordered, bounded queue and does not emulate packet reordering, correlated loss, kernel queues, or a congested WAN. Pion feedback/retransmission can mitigate some visible loss.

`scripts/netem.sh` is an optional Linux-only helper for OS-level experiments. It changes the **root qdisc of the selected interface** and affects all traffic through it. Use an isolated namespace or dedicated test interface; do not run it on your remote administrative interface.

```bash
sudo scripts/netem.sh veth-stream apply 120 30 8 2
sudo scripts/netem.sh veth-stream clear
```

The application never runs privileged `tc` commands.
