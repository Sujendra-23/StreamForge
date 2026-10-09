import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Expand,
  RotateCcw,
  Signal,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { StreamConnection } from "../lib/rtc";
import { savedName, useRoomCollab } from "../hooks/useRoomCollab";
import { RoomPanel } from "./RoomPanel";
import { EMPTY_METRICS, type Room } from "../lib/types";
import { Badge, Empty, Logo, StatusDot, Video } from "./shared";
export function Viewer({ id }: { id: string }) {
  const [stream, setStream] = useState<MediaStream | null>(null),
    [room, setRoom] = useState<Room | null>(null),
    [state, setState] = useState("connecting"),
    [error, setError] = useState(""),
    [metrics, setMetrics] = useState(EMPTY_METRICS),
    [muted, setMuted] = useState(true),
    [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const collab = useRoomCollab();
  const { callbacks: collabCallbacks, attach, reset } = collab;
  useEffect(() => {
    let disposed = false;
    setState("connecting");
    setError("");
    setStream(null);
    reset();
    const conn = new StreamConnection({
      ...collabCallbacks,
      onState: setState,
      onRoom: setRoom,
      onError: (e) => {
        setError(e);
        setState("failed");
      },
      onTrack: setStream,
    });
    const token = decodeURIComponent(location.hash.slice(1));
    attach(conn);
    conn
      .connect("subscribe", id, "", undefined, "H264", token, savedName())
      .catch((e) => {
        if (!disposed) {
          setError(e.message);
          setState("failed");
        }
      });
    let reading = false;
    const t = setInterval(async () => {
      if (reading) return;
      reading = true;
      try {
        const m = await conn.stats();
        if (!disposed) setMetrics(m);
      } catch {
      } finally {
        reading = false;
      }
    }, 1000);
    return () => {
      disposed = true;
      clearInterval(t);
      conn.close();
    };
  }, [id, attempt]);
  const live = state === "connected";
  return (
    <div className="viewer-page">
      <header>
        <a href="/">
          <Logo />
        </a>
        <a className="button secondary" href="/">
          <ArrowLeft size={14} />
          Back to Studio
        </a>
      </header>
      <main className="viewer-main">
        <div className="viewer-heading">
          <div>
            <div className="eyebrow">LIVE ON STREAMFORGE</div>
            <h1>{room?.title || "Connecting to the signal"}</h1>
          </div>
          <Badge tone={live ? "green" : "neutral"}>
            <StatusDot active={live} />
            {live ? "LIVE" : state.toUpperCase()}
          </Badge>
        </div>
        <div className="viewer-player" ref={container}>
          {stream && live ? (
            <Video stream={stream} muted={muted} />
          ) : (
            <Empty
              title={
                error ||
                (state === "ended"
                  ? "This stream has ended"
                  : state === "disconnected"
                    ? "Signal disconnected"
                    : "Finding your stream…")
              }
              detail={
                error
                  ? "The stream may be offline. Retry after the publisher starts broadcasting."
                  : state === "ended"
                    ? "Thanks for watching."
                    : "Establishing an encrypted WebRTC connection."
              }
              action={
                ["failed", "ended", "disconnected"].includes(state) ? (
                  <button
                    className="button secondary"
                    onClick={() => setAttempt((x) => x + 1)}
                  >
                    <RotateCcw size={14} />
                    Reconnect
                  </button>
                ) : undefined
              }
            />
          )}
          <div className="viewer-controls">
            <span>
              <StatusDot active={live} />
              {live
                ? `${metrics.width} × ${metrics.height} · ${Math.round(metrics.fps)} fps · ${metrics.codec}`
                : "Waiting for media"}
            </span>
            <div>
              <button
                className="icon-button"
                aria-label={muted ? "Unmute audio" : "Mute audio"}
                onClick={() => setMuted(!muted)}
              >
                {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </button>
              <button
                className="icon-button"
                aria-label="Fullscreen"
                onClick={() =>
                  container.current
                    ?.requestFullscreen()
                    .catch((e) => setError(e.message))
                }
              >
                <Expand size={18} />
              </button>
            </div>
          </div>
        </div>
        <div className="viewer-stats">
          <span>
            <Users size={16} />
            {room?.viewers ?? 0} viewers
          </span>
          <span>
            <Activity size={16} />
            {metrics.bitrate.toFixed(2)} Mbps
          </span>
          <span>
            <Signal size={16} />
            {metrics.loss.toFixed(1)}% loss
          </span>
          <span>{metrics.jitter.toFixed(1)} ms jitter</span>
          <span>{metrics.decodeMs.toFixed(1)} ms decode</span>
          <Badge>Local SFU</Badge>
        </div>
        {live && (
          <div className="viewer-collab">
            <RoomPanel collab={collab} />
          </div>
        )}
        <div className="viewer-description">
          <h3>Live, with nothing in the way.</h3>
          <p>
            Direct WebRTC playback. Your media travels through an encrypted
            connection, forwarded without transcoding.
          </p>
          <span className="mono">STREAM {id}</span>
        </div>
      </main>
      <footer>
        Powered by <strong>StreamForge</strong>
        <span>Built for every frame.</span>
      </footer>
    </div>
  );
}
