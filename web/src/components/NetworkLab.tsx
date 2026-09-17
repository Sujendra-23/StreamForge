import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  Beaker,
  Check,
  Download,
  FlaskConical,
  Gauge,
  Play,
  RotateCcw,
  ShieldCheck,
  Signal,
  Waves,
  Zap,
} from "lucide-react";
import { useState } from "react";
import type { Studio } from "../hooks/useStudio";
import { HEALTHY, type Network } from "../lib/types";
import { Badge, Empty, Sparkline, Toggle, downloadMetrics } from "./shared";
const presets = [
  {
    name: "Unrestricted",
    tag: "BASELINE",
    description: "Full bandwidth. No added impairment.",
    network: HEALTHY,
  },
  {
    name: "Coffee shop Wi-Fi",
    tag: "MODERATE",
    description: "Shared bandwidth and a little turbulence.",
    network: { bandwidthMbps: 4, latencyMs: 60, jitterMs: 15, lossPercent: 2 },
  },
  {
    name: "On the edge",
    tag: "SEVERE",
    description: "A tough connection. A real stress test.",
    network: { bandwidthMbps: 2, latencyMs: 120, jitterMs: 30, lossPercent: 8 },
  },
];
export function NetworkLab({
  s,
  goStudio,
}: {
  s: Studio;
  goStudio: () => void;
}) {
  const [draft, setDraft] = useState<Network>(s.network);
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.network);
  const controls = [
    {
      key: "bandwidthMbps",
      label: "Bandwidth ceiling",
      icon: ArrowDownUp,
      unit: "Mbps",
      min: 0.1,
      max: 100,
      step: 0.1,
    },
    {
      key: "latencyMs",
      label: "Added one-way delay",
      icon: Activity,
      unit: "ms",
      min: 0,
      max: 500,
      step: 5,
    },
    {
      key: "jitterMs",
      label: "Delay variation",
      icon: Waves,
      unit: "ms",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "lossPercent",
      label: "Packet loss",
      icon: Signal,
      unit: "%",
      min: 0,
      max: 30,
      step: 0.5,
    },
  ] as const;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BREAK THE NETWORK. KEEP THE SIGNAL.</div>
          <h1>
            Network lab <span className="heading-dot" />
          </h1>
          <p>Controlled chaos for your real-time stream.</p>
        </div>
        <Badge tone="orange">
          <FlaskConical size={13} />
          RTP impairment
        </Badge>
      </div>
      <div className="lab-notice">
        <Beaker size={18} />
        <div>
          <strong>Real packets. Real conditions.</strong>
          <span>
            Impairments apply at the SFU before forwarding to viewers. Open a
            viewer to observe playback and receive-side loss.
          </span>
        </div>
      </div>
      {!s.live && (
        <Empty
          title="Your experiment starts with a stream"
          detail="Go live in Studio, then come back to shape the network."
          action={
            <button className="button primary" onClick={goStudio}>
              Open Studio
              <ArrowRight size={15} />
            </button>
          }
        />
      )}
      <div className="preset-grid">
        {presets.map((p, i) => (
          <button
            key={p.name}
            className={`preset-card ${JSON.stringify(draft) === JSON.stringify(p.network) ? "selected" : ""}`}
            onClick={() => setDraft(p.network)}
          >
            <div>
              <span className="preset-icon">
                {i === 0 ? (
                  <ShieldCheck size={20} />
                ) : i === 1 ? (
                  <Waves size={20} />
                ) : (
                  <Zap size={20} />
                )}
              </span>
              <Badge tone={i === 2 ? "orange" : "neutral"}>{p.tag}</Badge>
            </div>
            <h3>{p.name}</h3>
            <p>{p.description}</p>
            <span className="preset-summary">
              {p.network.bandwidthMbps} Mbps <i /> {p.network.latencyMs} ms{" "}
              <i /> {p.network.lossPercent}% loss
            </span>
          </button>
        ))}
      </div>
      <div className="lab-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <Gauge size={16} />
              Network conditions
            </h2>
            {dirty ? (
              <Badge tone="orange">Unapplied changes</Badge>
            ) : (
              <Badge>
                <Check size={12} />
                In sync
              </Badge>
            )}
          </div>
          <div className="sliders">
            {controls.map((c) => (
              <div className="slider-control" key={c.key}>
                <label htmlFor={c.key}>
                  <c.icon size={15} />
                  {c.label}
                </label>
                <div className="slider-number">
                  <input
                    type="number"
                    aria-label={`${c.label} value`}
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={draft[c.key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [c.key]: Math.min(
                          c.max,
                          Math.max(c.min, Number(e.target.value)),
                        ),
                      })
                    }
                  />
                  <span>{c.unit}</span>
                </div>
                <input
                  id={c.key}
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={draft[c.key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [c.key]: Number(e.target.value) })
                  }
                />
                <div className="range-extents">
                  <span>
                    {c.min} {c.unit}
                  </span>
                  <span>
                    {c.max} {c.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="lab-actions">
            <button
              className="button secondary"
              disabled={!s.live}
              onClick={() => {
                setDraft(HEALTHY);
                s.applyNetwork(HEALTHY);
              }}
            >
              <RotateCcw size={14} />
              Restore network
            </button>
            <button
              className="button primary"
              disabled={!s.live || !dirty}
              onClick={() => s.applyNetwork(draft)}
            >
              <Play size={13} />
              Apply conditions
            </button>
          </div>
        </section>
        <div className="lab-right">
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <Zap size={16} />
                Adaptive controller
              </h2>
              <Toggle
                label="Adaptive controller"
                checked={s.adaptive}
                onChange={s.setAdaptive}
              />
            </div>
            <div className="controller-body">
              <div className="controller-status">
                <span
                  className={`controller-orb ${s.quality.height < 1080 ? "degraded" : ""}`}
                >
                  <Activity size={23} />
                </span>
                <div>
                  <div className="eyebrow">CURRENT STATE</div>
                  <h3>
                    {!s.live
                      ? "Standby"
                      : !s.adaptive
                        ? "Manual"
                        : s.quality.height < 1080
                          ? "Protecting the stream"
                          : "Network healthy"}
                  </h3>
                </div>
              </div>
              <div className="quality-readout">
                <strong>
                  {s.quality.label}
                  <span>{s.quality.fps}</span>
                </strong>
                <Badge>{s.metrics.codec || s.codec}</Badge>
                <span>{(s.quality.bitrate / 1e6).toFixed(1)} Mbps target</span>
              </div>
              <p>
                Quality decreases immediately under pressure. Three healthy
                samples trigger a one-step recovery.
              </p>
              <div className="controller-facts">
                <span>
                  Decision interval<strong>1 second</strong>
                </span>
                <span>
                  Source of pressure<strong>RTCP + injected profile</strong>
                </span>
                <span>
                  Adaptation<strong>Bitrate · resolution · FPS</strong>
                </span>
              </div>
            </div>
          </section>
          <section className="panel chart-panel">
            <div className="panel-heading">
              <h2>Measured outbound bitrate</h2>
              <span className="mono">{s.metrics.bitrate.toFixed(2)} Mbps</span>
            </div>
            <Sparkline
              values={s.history.map((x) => x.bitrate)}
              fill
              label="Actual outbound video bitrate"
            />
            <div className="chart-axis">
              <span>Earlier</span>
              <span>Now</span>
            </div>
          </section>
          <div className="lab-footnote">
            <Signal size={16} />
            <span>
              Publisher RTT measures the upstream hop. Injected delay and loss
              affect the downstream viewer hop.
            </span>
          </div>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Experiment log</h2>
          <button
            className="text-button"
            disabled={!s.history.length}
            onClick={() => downloadMetrics(s.history)}
          >
            <Download size={14} />
            Export telemetry
          </button>
        </div>
        {s.events.length ? (
          s.events.slice(0, 8).map((e) => (
            <div className="event-row" key={e.id}>
              <span className={`event-dot ${e.kind}`} />
              <span>{e.text}</span>
              <time>{e.time}</time>
            </div>
          ))
        ) : (
          <div className="event-row muted">
            No experiments yet. Apply a network profile to begin.
          </div>
        )}
      </section>
    </>
  );
}
