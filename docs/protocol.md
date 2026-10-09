# Signaling protocol v0.1

All media connections use `GET /ws`, JSON text messages, and one peer connection per socket. The browser and native C++ publisher use the same protocol.

## Start

Publisher:

```json
{"type":"publish","roomId":"demo-123","title":"Into the wild","tracks":2,"token":"operator-secret-when-enabled"}
```

Viewer:

```json
{"type":"subscribe","roomId":"demo-123","token":"signed-viewer-capability-when-enabled"}
```

The server answers `{"type":"ready","roomId":"demo-123","role":"publish","viewerToken":"..."}` when authentication is enabled (or a `subscribe` response without `viewerToken`). A publisher may omit `roomId` for a server-generated random ID. Otherwise IDs must match `[a-zA-Z0-9_-]{3,48}`. Titles have a 120-byte limit. A room has exactly one publisher. `tracks` declares 1 or 2 media tracks so early viewers wait for audio and video to be discovered before negotiating. Signed viewer capabilities include the room instance start time, so a link cannot authorize a later stream that reuses the same room ID.

The client is always the SDP offerer. Publishers add sending tracks; viewers add receiving audio/video transceivers. The server binds local forwarding tracks and produces the answer.

```json
{"type":"offer","sdp":{"type":"offer","sdp":"v=0..."}}
{"type":"answer","sdp":{"type":"answer","sdp":"v=0..."}}
{"type":"candidate","candidate":{"candidate":"candidate:...","sdpMid":"0","sdpMLineIndex":0}}
```

Both sides queue early ICE candidates until a remote description is installed. SDP is negotiated once per socket; source changes require ending and restarting the stream. No arbitrary cross-room signaling relay exists.

## Runtime

- Server → client: `{"type":"connection","state":"connected"}`.
- Server → client once per second: `{"type":"room","room":{...}}` with viewers, traffic counters, network configuration, and QoE.
- Publisher → server: `{"type":"network","network":{"bandwidthMbps":2,"latencyMs":120,"jitterMs":30,"lossPercent":8}}`.
- Server acknowledges a successful profile with `{"type":"network","network":{...}}`. The frontend only considers it applied after the acknowledgement.
- Browser → server: `{"type":"telemetry","metrics":{"bitrate":2.3,"fps":30,"rtt":25,"jitter":3,"loss":0.2,"encodeMs":4,"decodeMs":2}}`.
- Server → client on rejection: `{"type":"error","error":"Human-readable reason"}`.
- Client → server: `{"type":"leave"}` or socket close.
- Server → viewers when publisher leaves: `{"type":"ended"}`, then termination.

Publisher exit removes the room and disconnects viewers. Viewer exit removes its reservation and last reported QoE. ICE failure tears down the connection; the viewer offers a reconnect button. There is no automatic stream resurrection after publisher loss.

## Presence and shared note

Every authenticated socket, publisher or viewer, becomes a participant of its room once it passes the same checks as before (operator secret for the publisher, signed viewer capability for viewers in protected rooms). Both pieces of state belong to the room: they are in memory only and disappear when the publisher leaves.

Optional `name` on `publish`/`subscribe` sets the display name. The server strips control and formatting characters, collapses whitespace and truncates to 24 characters; if nothing is left it uses `Host` or `Viewer xxxx`. Names are labels, never identities: participants are told apart by `id`.

Server → client, right after `ready` and whenever something changes:

```json
{"type":"ready","roomId":"demo-123","role":"viewer","participantId":"9f2c41d07ab3e5c8"}
{"type":"presence","version":4,"participants":[{"id":"…","name":"Host","role":"publisher","joinedAt":"…"},{"id":"…","name":"Ana","role":"viewer","joinedAt":"…"}]}
{"type":"note","note":{"text":"Agenda","version":2,"byId":"…","byName":"Ana","updatedAt":"…"}}
```

`presence` always carries the whole list and a `version` that grows on every join, leave and rename. Clients ignore any version they have already passed, and work out who joined or left by comparing lists. State is pushed as "latest value", not as a queue of events: a slow client skips intermediate states instead of blocking the room.

Client → server:

```json
{"type":"note","text":"Agenda: demo, Q&A","baseVersion":1}
{"type":"rename","name":"Ana"}
```

- The note is **last-writer-wins**. Every accepted `note` message replaces the text and increments `note.version`, whatever `baseVersion` says. `baseVersion` (the version the writer's edit was based on) only decides the acknowledgement: `{"type":"note_ack","version":3,"overwrote":true}` means someone else's newer note was replaced. Saving unchanged text is a no-op and does not bump the version. Everyone, including the writer, receives the resulting `note`.
- Limits: 4096 bytes (UTF-8, newlines and tabs allowed, other control characters rejected), 5 writes burst and 5 per second sustained per participant, at most 128 participants per room. Violations get `{"type":"error",...}` and the socket stays open.
- There is no merge and no history; if two people edit at once, one edit is lost by design. Use the `overwrote` flag (the studio and viewer panels show it) rather than assuming a save was the final text.

## Telemetry semantics

Bitrate is the interval delta in WebRTC video bytes. Frame rate is encoded/decoded frame rate from WebRTC stats, with interval frame-count fallback. Publisher RTT/loss represent the publisher-to-SFU hop. Viewer loss/jitter describe the SFU-to-viewer hop. Encode/decode time is the interval processing time divided by the interval frame count, not end-to-end latency.

The single shared upstream quality controller uses the worst reported viewer loss/RTT, upstream RTCP, and the injected network profile. A slow viewer can reduce quality for everyone; there is no simulcast or per-viewer layer selection yet. Telemetry comes from clients and is suitable for a trusted local lab, not for security/billing decisions.

Metrics are published under `streamforge_*` on `/metrics`. Unmeasured values start at zero. Frame and packet counters reset with each room; Prometheus `rate()` handles those resets. `forwarded_packets_total` counts forwarding operations before fan-out, not packets multiplied by audience size. `dropped_packets_total` includes random impairment and bounded-queue drops.

When `STREAMFORGE_AUTH_SECRET` is set, `/api/rooms`, `/api/rooms/{id}`, and `/api/history` require `Authorization: Bearer <operator-secret>`. `/api/history` returns completed session summaries loaded from `STREAMFORGE_HISTORY_PATH`; active media and peer connections remain in memory.

## Reference APIs

- [GStreamer webrtcbin](https://gstreamer.freedesktop.org/documentation/webrtc/)
- [Pion WebRTC](https://github.com/pion/webrtc)
- [W3C WebRTC specification](https://www.w3.org/TR/webrtc/)
- [coder/websocket](https://github.com/coder/websocket)
