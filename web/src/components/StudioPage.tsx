import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  AudioLines,
  Camera,
  Check,
  CircleHelp,
  Copy,
  Download,
  Expand,
  Gauge,
  Link,
  Mic,
  MicOff,
  Monitor,
  Radio,
  Settings2,
  ShieldCheck,
  Signal,
  Square,
  Users,
  Video as VideoIcon,
  Waves,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import type { Studio } from "../hooks/useStudio";
import { QUALITY_LEVELS } from "../lib/adaptive";
import type { Page, Source } from "../lib/types";
import { RoomPanel } from "./RoomPanel";
import {
  Badge,
  HealthCheck,
  MetricCard,
  Scene,
  StatusDot,
  Toggle,
  Video,
  downloadMetrics,
} from "./shared";
export function StudioPage({
  s,
  navigate,
}: {
  s: Studio;
  navigate: (page: Page) => void;
}) {
  const [copied, setCopied] = useState(false);
  const player = useRef<HTMLDivElement>(null);
  const m = s.metrics;
  const share = async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/watch/${s.roomId}${s.viewerToken ? `#${encodeURIComponent(s.viewerToken)}` : ""}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      s.setError(
        "Clipboard unavailable. Open the viewer and copy its address.",
      );
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR BROADCAST, UNDER CONTROL</div>
          <h1>
            Streaming studio <span className="heading-dot" />
          </h1>
          <p>From first frame to final mile. Make every packet count.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button secondary"
            disabled={!s.history.length}
            onClick={() => downloadMetrics(s.history)}
          >
            <Download size={15} />
            Export metrics
          </button>
          <button
            className={`button ${s.live ? "danger" : "primary"}`}
            disabled={s.busy}
            onClick={() => (s.live ? s.stop() : s.start())}
          >
            {s.live ? (
              <Square size={14} fill="currentColor" />
            ) : (
              <Radio size={16} />
            )}{" "}
            {s.live ? "End stream" : s.busy ? "Connecting…" : "Go live"}
            {!s.live && !s.busy && <ArrowRight size={15} />}
          </button>
        </div>
      </div>
      <div className="studio-layout">
        <div className="studio-main">
          <section className="panel preview-panel">
            <div className="panel-heading">
              <h2>
                <VideoIcon size={16} />
                Live preview
              </h2>
              <div className="preview-heading-right">
                <Badge tone={s.live ? "green" : "neutral"}>
                  <StatusDot active={s.live} />
                  {s.live ? "Broadcasting" : "Ready to stream"}
                </Badge>
                <button
                  className="icon-button"
                  title="Fullscreen preview"
                  aria-label="Fullscreen preview"
                  onClick={() =>
                    player.current
                      ?.requestFullscreen()
                      .catch((e) => s.setError(e.message))
                  }
                >
                  <Expand size={15} />
                </button>
              </div>
            </div>
            <div className="preview-screen" ref={player}>
              {s.stream ? <Video stream={s.stream} /> : <Scene />}
              <div className="preview-top">
                <span className={`live-label ${s.live ? "on" : ""}`}>
                  <StatusDot active={s.live} />
                  {s.live ? "LIVE" : "PREVIEW"}
                </span>
                <span className="source-label">
                  <Monitor size={12} />
                  {s.source === "demo"
                    ? "Landscape · Test source"
                    : s.source === "screen"
                      ? "Screen capture"
                      : "Camera input"}
                </span>
              </div>
              <div className="preview-title">
                <span>THE WORLD IS YOUR STAGE</span>
                <h2>{s.title || "Untitled stream"}</h2>
                <p>
                  {s.live
                    ? "One source. Every viewer. Real time."
                    : "A little signal. A whole new perspective."}
                </p>
              </div>
              <div className="preview-bottom">
                <span>
                  <span className="tiny-dot" />
                  {s.live
                    ? `${m.width || s.quality.width} × ${m.height || s.quality.height}`
                    : "1920 × 1080"}{" "}
                  <i /> {s.live ? Math.round(m.fps) : 30} FPS
                </span>
                <span>
                  {s.live ? m.codec || s.codec : s.codec}
                  <i />
                  WebRTC
                </span>
              </div>
            </div>
            <div className="source-toolbar">
              <div className="source-tabs">
                {(
                  [
                    { id: "demo", label: "Test source", icon: Waves },
                    { id: "camera", label: "Camera", icon: Camera },
                    { id: "screen", label: "Screen share", icon: Monitor },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    disabled={s.live || s.busy}
                    className={s.source === item.id ? "selected" : ""}
                    onClick={() => s.setSource(item.id as Source)}
                  >
                    <item.icon size={15} />
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                className={`icon-button mic-button ${s.mic ? "enabled" : ""}`}
                aria-label={s.mic ? "Mute microphone" : "Enable microphone"}
                title={
                  s.live
                    ? "Toggle microphone"
                    : "Include microphone on next stream"
                }
                onClick={() => (s.live ? s.toggleMute() : s.setMic(!s.mic))}
              >
                {s.mic ? <Mic size={16} /> : <MicOff size={16} />}
              </button>
            </div>
          </section>
          <div className="section-heading">
            <h2>
              Stream health{" "}
              <Badge tone={s.live ? "green" : "neutral"}>
                {s.live ? "Live telemetry" : "Awaiting signal"}
              </Badge>
            </h2>
            <span>
              <span className={`status-dot ${s.live ? "active" : ""}`} />
              Updated every second
            </span>
          </div>
          <div className="metrics-grid">
            <MetricCard
              label="Video bitrate"
              value={s.live ? m.bitrate.toFixed(2) : "—"}
              unit="Mbps"
              values={s.history.map((x) => x.bitrate)}
              detail={
                s.live ? "Measured outbound video" : "Start a stream to measure"
              }
              icon={<ArrowDownUp size={15} />}
            />
            <MetricCard
              label="Round-trip time"
              value={s.live ? m.rtt.toFixed(0) : "—"}
              unit="ms"
              values={s.history.map((x) => x.rtt)}
              color="#67929f"
              detail="Publisher ↔ SFU"
              icon={<Activity size={15} />}
            />
            <MetricCard
              label="Packet loss"
              value={s.live ? m.loss.toFixed(1) : "—"}
              unit="%"
              values={s.history.map((x) => x.loss)}
              color="#aa93c7"
              detail="Reported by SFU receiver"
              icon={<Signal size={15} />}
            />
            <MetricCard
              label="Frame rate"
              value={s.live ? Math.round(m.fps).toString() : "—"}
              unit="fps"
              values={s.history.map((x) => x.fps)}
              color="#6b9b7e"
              detail={
                s.live
                  ? `${m.width} × ${m.height} encoded`
                  : "Actual encoded frames"
              }
              icon={<Gauge size={15} />}
            />
          </div>
          <div className="bottom-panels">
            <section className="panel pipeline-panel">
              <div className="panel-heading">
                <h2>
                  <Zap size={16} />
                  Media pipeline
                </h2>
                <Badge tone={s.live ? "green" : "neutral"}>
                  {s.live ? "Connected" : "Standby"}
                </Badge>
              </div>
              <div className="pipeline">
                <div>
                  <span className="pipeline-icon">
                    <Camera size={19} />
                  </span>
                  <strong>Capture</strong>
                  <small>
                    {s.source === "demo"
                      ? "Canvas"
                      : s.source === "camera"
                        ? "Camera"
                        : "Screen"}
                  </small>
                </div>
                <span className={`pipeline-line ${s.live ? "flow" : ""}`} />
                <div>
                  <span className="pipeline-icon">
                    <Settings2 size={19} />
                  </span>
                  <strong>Encode</strong>
                  <small>{m.codec || s.codec}</small>
                </div>
                <span className={`pipeline-line ${s.live ? "flow" : ""}`} />
                <div>
                  <span className="pipeline-icon">
                    <ArrowDownUp size={19} />
                  </span>
                  <strong>Forward</strong>
                  <small>Local SFU</small>
                </div>
                <span className={`pipeline-line ${s.live ? "flow" : ""}`} />
                <div>
                  <span className="pipeline-icon">
                    <Users size={19} />
                  </span>
                  <strong>Viewers</strong>
                  <small>{s.room?.viewers ?? 0} connected</small>
                </div>
              </div>
              <div className="panel-foot">
                <ShieldCheck size={14} />
                DTLS-SRTP encrypted transport
                <span>
                  {s.live ? "Transport active" : "Ready when you are"}
                </span>
              </div>
            </section>
            <section className="lab-callout">
              <div className="lab-callout-top">
                <span className="lab-icon">
                  <Activity size={20} />
                </span>
                <Badge>BUILT TO EXPERIMENT</Badge>
              </div>
              <h3>
                Good streams.
                <br />
                Bad networks.
              </h3>
              <p>Push your stream to the limit. Watch it adapt in real time.</p>
              <button onClick={() => navigate("lab")}>
                Open Network Lab
                <ArrowRight size={16} />
              </button>
            </section>
          </div>
        </div>
        <aside className="studio-aside">
          <section className="panel configuration">
            <div className="panel-heading">
              <h2>
                <Settings2 size={16} />
                Stream configuration
              </h2>
              <CircleHelp size={15} className="muted" />
            </div>
            <div className="config-body">
              <label className="field-label" htmlFor="stream-title">
                Stream title
              </label>
              <input
                id="stream-title"
                value={s.title}
                onChange={(e) => s.setTitle(e.target.value)}
                maxLength={120}
                disabled={s.live || s.busy}
              />
              <div className="config-separator" />
              <div className="subheading">
                <VideoIcon size={14} />
                VIDEO
              </div>
              <label className="field-label" htmlFor="codec">
                Video codec <Badge>REAL-TIME</Badge>
              </label>
              <select
                id="codec"
                value={s.codec}
                disabled={s.live || s.busy}
                onChange={(e) => s.setCodec(e.target.value)}
              >
                <option value="H264">H.264 — Compatible</option>
                <option value="VP8">VP8 — Open codec</option>
                {RTCRtpSender.getCapabilities("video")?.codecs.some(
                  (c) => c.mimeType === "video/AV1",
                ) && <option value="AV1">AV1 — Browser encoder</option>}
              </select>
              <div className="two-fields">
                <div>
                  <label className="field-label" htmlFor="resolution">
                    Resolution
                  </label>
                  <select
                    id="resolution"
                    value={Math.min(s.ceiling, 2).toString()}
                    disabled={s.live || s.busy}
                    onChange={(e) => s.setCeiling(Number(e.target.value))}
                  >
                    <option value="0">360p</option>
                    <option value="1">720p</option>
                    <option value="2">1080p</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="framerate">
                    Frame rate
                  </label>
                  <select
                    id="framerate"
                    value={QUALITY_LEVELS[s.ceiling].fps}
                    disabled={s.live || s.busy || s.ceiling < 2}
                    onChange={(e) =>
                      s.setCeiling(Number(e.target.value) === 60 ? 3 : 2)
                    }
                  >
                    {s.ceiling === 0 ? (
                      <option value="20">20 fps</option>
                    ) : (
                      <option value="30">30 fps</option>
                    )}
                    {s.ceiling >= 2 && <option value="60">60 fps</option>}
                  </select>
                </div>
              </div>
              <div className="config-row">
                <span>Target bitrate</span>
                <strong>
                  {(QUALITY_LEVELS[s.ceiling].bitrate / 1e6).toFixed(1)}{" "}
                  <span>Mbps</span>
                </strong>
              </div>
              <div className="adaptive-row">
                <span className="adaptive-icon">
                  <Zap size={16} />
                </span>
                <div>
                  <strong>Adaptive quality</strong>
                  <span>Keep the stream flowing</span>
                </div>
                <Toggle
                  checked={s.adaptive}
                  onChange={s.setAdaptive}
                  label="Adaptive quality"
                />
              </div>
              <div className="config-separator" />
              <div className="subheading">
                <AudioLines size={15} />
                AUDIO
              </div>
              <div className="config-row">
                <span>
                  Microphone <small>Opus · echo cancellation</small>
                </span>
                <Toggle
                  checked={s.mic}
                  disabled={s.live || s.busy}
                  onChange={s.setMic}
                  label="Include microphone"
                />
              </div>
              <div className="config-separator" />
              <div className="connection-summary">
                <span>
                  <StatusDot active={s.live} />
                  {s.live ? "Transport connected" : "Local environment"}
                </span>
                <span>
                  WebRTC
                  <ArrowRight size={12} />
                  SFU
                </span>
              </div>
            </div>
          </section>
          <section className="panel connection-panel">
            <div className="panel-heading">
              <h2>
                <ShieldCheck size={16} />
                Connection
              </h2>
            </div>
            <div className="connection-body">
              <HealthCheck
                label="Signaling"
                value={s.live ? "Connected" : "Standby"}
                ok={s.live}
              />
              <HealthCheck
                label="Media transport"
                value={s.live ? "DTLS-SRTP" : "WebRTC"}
                ok={s.live}
              />
              <HealthCheck label="Region" value="Local" ok={s.live} />
              <HealthCheck
                label="Viewers"
                value={String(s.room?.viewers ?? 0)}
                ok={(s.room?.viewers ?? 0) > 0}
              />
            </div>
            <div className="share-actions">
              <button
                className="button secondary"
                disabled={!s.live}
                onClick={share}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
                {copied ? "Copied!" : "Copy viewer link"}
              </button>
              {s.live && (
                <a
                  href={`/watch/${s.roomId}${s.viewerToken ? `#${encodeURIComponent(s.viewerToken)}` : ""}`}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-button"
                  aria-label="Open viewer"
                >
                  <Link size={15} />
                </a>
              )}
            </div>
          </section>
          {s.live && <RoomPanel collab={s.collab} />}
          <div className="studio-note">
            <span>
              <Radio size={15} />
            </span>
            <p>
              One source. Multiple viewers.
              <br />
              <strong>No transcoding. Just forwarding.</strong>
            </p>
          </div>
        </aside>
      </div>
      <section className="panel activity-panel">
        <div className="panel-heading">
          <h2>
            <Activity size={16} />
            Session activity
          </h2>
          <span className="muted">{s.events.length} events</span>
        </div>
        {s.events.length ? (
          s.events.slice(0, 4).map((e) => (
            <div className="event-row" key={e.id}>
              <span className={`event-dot ${e.kind}`} />
              <span>{e.text}</span>
              <time>{e.time}</time>
            </div>
          ))
        ) : (
          <div className="event-row">
            <span className="event-dot" />
            <span>
              Studio is ready. Start a stream to see connection and quality
              events here.
            </span>
            <span className="muted">Waiting</span>
          </div>
        )}
      </section>
    </>
  );
}
