import { EMPTY_METRICS, type Metrics, type Network, type Room } from "./types";
import { operatorToken } from "./auth";
export type Callbacks = {
  onState: (state: string) => void;
  onRoom: (room: Room) => void;
  onError: (message: string) => void;
  onTrack?: (stream: MediaStream) => void;
  onReady?: (id: string, viewerToken: string) => void;
  onNetwork?: (network: Network) => void;
};
export class StreamConnection {
  pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private pending: RTCIceCandidateInit[] = [];
  private closed = false;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private previous = new Map<
    string,
    {
      bytes: number;
      timestamp: number;
      frames: number;
      lost: number;
      packets: number;
      encode: number;
      decode: number;
    }
  >();
  private sequence: Promise<void> = Promise.resolve();
  constructor(private callbacks: Callbacks) {}
  async connect(
    role: "publish" | "subscribe",
    roomId: string,
    title: string,
    stream?: MediaStream,
    codec = "H264",
    accessToken = "",
  ) {
    const res = await fetch("/api/config", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error("Signaling server unavailable");
    const config = await res.json();
    const token = role === "publish" ? operatorToken() : accessToken;
    if (role === "publish" && config.authRequired && !token)
      throw new Error(
        "This server requires an operator token. Save it in Settings before going live.",
      );
    if (this.closed) return;
    this.pc = new RTCPeerConnection({ iceServers: config.iceServers });
    const pc = this.pc;
    this.connectionTimer = setTimeout(() => {
      if (!this.closed && pc.connectionState !== "connected") {
        this.callbacks.onError(
          "Media connection timed out. Check the server and ICE/TURN configuration, then reconnect.",
        );
        this.close();
      }
    }, 20000);
    const remote = new MediaStream();
    pc.ontrack = (e) => {
      remote.addTrack(e.track);
      this.callbacks.onTrack?.(remote);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && this.connectionTimer)
        clearTimeout(this.connectionTimer);
      if (!this.closed) this.callbacks.onState(pc.connectionState);
    };
    if (stream)
      for (const track of stream.getTracks()) {
        const transceiver = pc.addTransceiver(track, {
          direction: "sendonly",
          streams: [stream],
        });
        if (track.kind === "video") {
          const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
          const preferred = codecs.filter(
            (c) => c.mimeType.toLowerCase() === `video/${codec.toLowerCase()}`,
          );
          if (preferred.length && transceiver.setCodecPreferences)
            transceiver.setCodecPreferences([
              ...preferred,
              ...codecs.filter((c) => !preferred.includes(c)),
            ]);
        }
      }
    else {
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
    }
    this.ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    const ws = this.ws;
    pc.onicecandidate = (e) => {
      if (e.candidate)
        this.send({ type: "candidate", candidate: e.candidate.toJSON() });
    };
    ws.onopen = () =>
      this.send({
        type: role,
        roomId,
        title,
        tracks: stream?.getTracks().length ?? 0,
        token,
      });
    ws.onerror = () =>
      this.callbacks.onError(
        "Cannot reach signaling server. Make sure the Go service is running.",
      );
    ws.onclose = () => {
      if (!this.closed) {
        this.close();
        this.callbacks.onState("disconnected");
      }
    };
    ws.onmessage = (e) => {
      // Serial processing prevents ICE / answer races.
      this.sequence = this.sequence
        .then(async () => {
          if (this.closed) return;
          const msg = JSON.parse(e.data);
          switch (msg.type) {
            case "ready":
              this.callbacks.onReady?.(msg.roomId, msg.viewerToken ?? "");
              await pc.setLocalDescription(await pc.createOffer());
              this.send({ type: "offer", sdp: pc.localDescription });
              break;
            case "answer":
              await pc.setRemoteDescription(msg.sdp);
              for (const c of this.pending) await pc.addIceCandidate(c);
              this.pending = [];
              break;
            case "candidate":
              if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate);
              else this.pending.push(msg.candidate);
              break;
            case "room":
              this.callbacks.onRoom(msg.room);
              break;
            case "network":
              this.callbacks.onNetwork?.(msg.network);
              break;
            case "error":
              this.callbacks.onError(msg.error);
              break;
            case "ended":
              this.callbacks.onState("ended");
              this.close();
              break;
          }
        })
        .catch((e) => {
          if (!this.closed) this.callbacks.onError(e.message);
        });
    };
  }
  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(data));
  }
  setNetwork(network: Network) {
    this.send({ type: "network", network });
  }
  async setQuality(bitrate: number, fps: number, scale: number) {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const p = sender.getParameters();
    if (!p.encodings?.length) return;
    p.encodings[0].maxBitrate = bitrate;
    p.encodings[0].maxFramerate = fps;
    p.encodings[0].scaleResolutionDownBy = Math.max(1, scale);
    p.degradationPreference = "balanced";
    await sender.setParameters(p);
  }
  async stats(): Promise<Metrics> {
    const m = { ...EMPTY_METRICS, timestamp: Date.now() };
    if (!this.pc || this.closed) return m;
    const stats = await this.pc.getStats();
    stats.forEach((s) => {
      if (s.type === "candidate-pair" && s.state === "succeeded" && s.nominated)
        m.rtt = (s.currentRoundTripTime ?? 0) * 1000;
      if (s.type === "remote-inbound-rtp" && s.kind === "video") {
        m.loss = Math.max(0, (s.fractionLost ?? 0) * 100);
        m.jitter = (s.jitter ?? 0) * 1000;
        if (s.roundTripTime) m.rtt = s.roundTripTime * 1000;
      }
      if (
        (s.type === "outbound-rtp" || s.type === "inbound-rtp") &&
        s.kind === "video"
      ) {
        const bytes = s.bytesSent ?? s.bytesReceived ?? 0,
          frames = s.framesEncoded ?? s.framesDecoded ?? 0,
          lost = s.packetsLost ?? 0,
          packets = s.packetsReceived ?? s.packetsSent ?? 0;
        const prev = this.previous.get(s.id),
          dt = prev ? (s.timestamp - prev.timestamp) / 1000 : 0;
        m.bitrate =
          prev && dt > 0
            ? Math.max(0, ((bytes - prev.bytes) * 8) / dt / 1e6)
            : 0;
        m.fps =
          s.framesPerSecond ??
          (prev && dt > 0 ? (frames - prev.frames) / dt : 0);
        m.width = s.frameWidth ?? 0;
        m.height = s.frameHeight ?? 0;
        m.frames = frames;
        m.dropped = s.framesDropped ?? 0;
        m.codec = stats.get(s.codecId)?.mimeType?.split("/")[1] ?? "";
        m.nack = s.nackCount ?? 0;
        m.pli = s.pliCount ?? 0;
        const deltaFrames = prev ? frames - prev.frames : 0;
        if (deltaFrames > 0) {
          m.encodeMs = Math.max(
            0,
            (((s.totalEncodeTime ?? 0) - (prev?.encode ?? 0)) / deltaFrames) *
              1000,
          );
          m.decodeMs = Math.max(
            0,
            (((s.totalDecodeTime ?? 0) - (prev?.decode ?? 0)) / deltaFrames) *
              1000,
          );
        }
        if (s.type === "inbound-rtp") {
          m.jitter = (s.jitter ?? 0) * 1000;
          const dp = prev ? packets - prev.packets : 0,
            dl = prev ? Math.max(0, lost - prev.lost) : 0;
          m.loss = dp + dl > 0 ? (dl / (dp + dl)) * 100 : 0;
        }
        this.previous.set(s.id, {
          bytes,
          timestamp: s.timestamp,
          frames,
          lost,
          packets,
          encode: s.totalEncodeTime ?? 0,
          decode: s.totalDecodeTime ?? 0,
        });
      }
    });
    this.send({ type: "telemetry", metrics: m });
    return m;
  }
  close() {
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.closed = true;
    this.send({ type: "leave" });
    this.ws?.close();
    this.pc?.close();
    this.ws = null;
    this.pc = null;
  }
}
