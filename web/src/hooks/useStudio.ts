import { useCallback, useEffect, useRef, useState } from "react";
import { StreamConnection } from "../lib/rtc";
import { createDemoStream } from "../lib/demo";
import { AdaptiveController, QUALITY_LEVELS } from "../lib/adaptive";
import {
  EMPTY_METRICS,
  HEALTHY,
  type Event,
  type Metrics,
  type Network,
  type Quality,
  type Room,
  type Source,
} from "../lib/types";
export function useStudio() {
  const [title, setTitle] = useState(
    () => localStorage.getItem("sf-title") || "Into the wild",
  );
  const [source, setSource] = useState<Source>("demo"),
    [codec, setCodec] = useState("H264"),
    [ceiling, setCeiling] = useState(2),
    [mic, setMic] = useState(false),
    [adaptive, setAdaptive] = useState(true);
  const [status, setStatus] = useState("idle"),
    [stream, setStream] = useState<MediaStream | null>(null),
    [room, setRoom] = useState<Room | null>(null),
    [roomId, setRoomId] = useState("");
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS),
    [history, setHistory] = useState<Metrics[]>([]),
    [network, setNetwork] = useState<Network>(HEALTHY),
    [quality, setQuality] = useState<Quality>(QUALITY_LEVELS[2]);
  const [error, setError] = useState(""),
    [events, setEvents] = useState<Event[]>([]);
  const connection = useRef<StreamConnection | null>(null),
    cleanup = useRef<(() => void) | null>(null),
    controller = useRef(new AdaptiveController()),
    busy = useRef(false),
    session = useRef(0);
  const current = useRef({ network, adaptive, room });
  current.current = { network, adaptive, room };
  const log = useCallback(
    (text: string, kind: Event["kind"] = "info") =>
      setEvents((e) =>
        [
          {
            id: Date.now() + Math.random(),
            time: new Date().toLocaleTimeString("en-GB"),
            text,
            kind,
          },
          ...e,
        ].slice(0, 50),
      ),
    [],
  );
  const release = useCallback(() => {
    session.current++;
    connection.current?.close();
    connection.current = null;
    cleanup.current?.();
    cleanup.current = null;
    setStream(null);
    busy.current = false;
  }, []);
  const stop = useCallback(() => {
    release();
    setStatus("idle");
    setRoom(null);
    setNetwork(HEALTHY);
    log("Stream ended. All media tracks released.");
  }, [release, log]);
  useEffect(
    () => () => {
      session.current++;
      connection.current?.close();
      cleanup.current?.();
    },
    [],
  );
  useEffect(() => {
    localStorage.setItem("sf-title", title);
  }, [title]);
  const start = async () => {
    if (busy.current || connection.current) return;
    busy.current = true;
    setError("");
    setStatus("connecting");
    setHistory([]);
    setMetrics(EMPTY_METRICS);
    setRoom(null);
    setNetwork(HEALTHY);
    const version = ++session.current;
    try {
      const q = QUALITY_LEVELS[ceiling];
      let media: MediaStream;
      let dispose: () => void;
      if (source === "demo") {
        const demo = createDemoStream(q.width, q.height, q.fps);
        media = demo.stream;
        dispose = demo.cleanup;
      } else if (source === "screen") {
        media = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: q.fps },
          audio: false,
        });
        dispose = () => media.getTracks().forEach((t) => t.stop());
      } else {
        media = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: q.width },
            height: { ideal: q.height },
            frameRate: { ideal: q.fps },
          },
          audio: false,
        });
        dispose = () => media.getTracks().forEach((t) => t.stop());
      }
      if (version !== session.current) {
        dispose();
        return;
      }
      cleanup.current = dispose;
      if (mic) {
        const audio = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (version !== session.current) {
          audio.getTracks().forEach((t) => t.stop());
          dispose();
          return;
        }
        audio.getAudioTracks().forEach((t) => media.addTrack(t));
        cleanup.current = () => {
          dispose();
          audio.getTracks().forEach((t) => t.stop());
        };
      }
      if (version !== session.current) {
        dispose();
        return;
      }
      media.getVideoTracks()[0].addEventListener("ended", stop, { once: true });
      setStream(media);
      controller.current = new AdaptiveController(ceiling);
      setQuality(q);
      const conn = new StreamConnection({
        onState: (s) => {
          if (version !== session.current) return;
          setStatus(s);
          if (s === "connected") {
            busy.current = false;
            log("Media connected through the local SFU.", "success");
            void conn
              .setQuality(q.bitrate, q.fps, 1)
              .catch((e) => setError(e.message));
          }
          if (["failed", "disconnected", "ended"].includes(s)) {
            release();
            setRoom(null);
            log(`Connection ${s}. Restart to reconnect.`, "warning");
          }
        },
        onRoom: setRoom,
        onReady: (id) => {
          setRoomId(id);
          log(`Signaling ready · ${id}`);
        },
        onNetwork: (n) => {
          setNetwork(n);
          log(
            n.lossPercent || n.latencyMs || n.bandwidthMbps < 100
              ? "Network impairment applied to RTP forwarding."
              : "Healthy network restored.",
            n.lossPercent ? "warning" : "success",
          );
        },
        onError: (e) => {
          setError(e);
          log(e, "warning");
          if (busy.current) {
            release();
            setStatus("failed");
          }
        },
      });
      connection.current = conn;
      await conn.connect(
        "publish",
        crypto.randomUUID().slice(0, 8),
        title,
        media,
        codec,
      );
    } catch (e) {
      if (version !== session.current) return;
      release();
      setStatus("failed");
      const message = e instanceof Error ? e.message : "Unable to start stream";
      setError(message);
      log(message, "warning");
    }
  };
  useEffect(() => {
    if (status !== "connected") return;
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      const conn = connection.current;
      if (!conn) return;
      running = true;
      try {
        const m = await conn.stats();
        if (connection.current !== conn) return;
        setMetrics(m);
        setHistory((h) => [...h, m].slice(-300));
        if (current.current.adaptive) {
          const result = controller.current.step(
            current.current.network,
            Math.max(m.rtt, current.current.room?.viewerQoE?.rtt ?? 0),
            Math.max(m.loss, current.current.room?.viewerQoE?.loss ?? 0),
          );
          if (result.changed) {
            const q = result.quality;
            const baseHeight =
              QUALITY_LEVELS[controller.current.ceiling].height;
            await conn.setQuality(
              q.bitrate,
              q.fps,
              Math.max(1, baseHeight / q.height),
            );
            setQuality(q);
            log(
              `${result.reason} → ${q.label}${q.fps} · ${(q.bitrate / 1e6).toFixed(1)} Mbps`,
              result.reason.includes("recovered") ? "success" : "warning",
            );
          }
        }
      } catch (e) {
        if (connection.current === conn)
          setError(e instanceof Error ? e.message : "Telemetry unavailable");
      } finally {
        running = false;
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [status, log]);
  const applyNetwork = (n: Network) => {
    if (status !== "connected") {
      setError("Start a stream in Studio to run a network experiment.");
      return;
    }
    connection.current?.setNetwork(n);
  };
  const changeAdaptive = async (value: boolean) => {
    setAdaptive(value);
    if (!value && connection.current) {
      controller.current = new AdaptiveController(ceiling);
      const q = QUALITY_LEVELS[ceiling];
      await connection.current
        .setQuality(q.bitrate, q.fps, 1)
        .catch((e) => setError(e.message));
      setQuality(q);
      log("Automatic adaptation paused. Configured quality restored.");
    }
  };
  const toggleMute = () => {
    const tracks = stream?.getAudioTracks();
    if (!tracks?.length) {
      setError("Enable the microphone before starting your next stream.");
      return;
    }
    tracks.forEach((t) => {
      t.enabled = !t.enabled;
    });
    setMic(tracks[0].enabled);
  };
  return {
    title,
    setTitle,
    source,
    setSource,
    codec,
    setCodec,
    ceiling,
    setCeiling,
    mic,
    setMic,
    adaptive,
    setAdaptive: changeAdaptive,
    status,
    stream,
    room,
    roomId,
    metrics,
    history,
    network,
    quality,
    error,
    setError,
    events,
    log,
    start,
    stop,
    applyNetwork,
    toggleMute,
    live: status === "connected",
    busy: status === "connecting" || status === "new",
  };
}
export type Studio = ReturnType<typeof useStudio>;
