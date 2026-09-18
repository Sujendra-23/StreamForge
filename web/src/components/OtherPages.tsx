import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Camera,
  Check,
  Cpu,
  ExternalLink,
  Globe,
  Layers,
  Monitor,
  Radio,
  Server,
  Settings2,
  Users,
} from "lucide-react";
import type { Room } from "../lib/types";
import { operatorHeaders, operatorToken, setOperatorToken } from "../lib/auth";
import { Badge, Empty, Scene, StatusDot } from "./shared";
export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([]),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      try {
        const r = await fetch("/api/rooms", {
          signal: abort.signal,
          headers: operatorHeaders(),
        });
        if (!r.ok) throw new Error("Signaling server is unavailable");
        setRooms(await r.json());
        setError("");
        setReady(true);
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(e instanceof Error ? e.message : "Connection failed");
          setReady(true);
        }
      }
    };
    void load();
    const t = setInterval(load, 2000);
    return () => {
      abort.abort();
      clearInterval(t);
    };
  }, []);
  return { rooms, error, ready };
}
export function StreamsPage({ goStudio }: { goStudio: () => void }) {
  const { rooms, error, ready } = useRooms();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">EVERY SIGNAL HAS A STORY</div>
          <h1>Live streams</h1>
          <p>Your active broadcasts, all in one place.</p>
        </div>
        <button className="button primary" onClick={goStudio}>
          <Radio size={15} />
          Create a stream
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {!ready ? (
        <Empty
          title="Connecting to the server…"
          detail="Loading active streams."
        />
      ) : !rooms.length ? (
        <Empty
          title="The stage is yours"
          detail="Start a broadcast from Studio. Active streams and viewer links will appear here."
          action={
            <button className="button primary" onClick={goStudio}>
              Open Studio
              <ArrowRight size={15} />
            </button>
          }
        />
      ) : (
        <div className="stream-grid">
          {rooms.map((r) => (
            <a
              key={r.id}
              className="stream-card panel"
              href={`/watch/${r.id}${r.viewerToken ? `#${encodeURIComponent(r.viewerToken)}` : ""}`}
              target="_blank"
              rel="noreferrer"
            >
              <div className="stream-thumbnail">
                <Scene />
                <Badge tone="green">
                  <StatusDot active />
                  LIVE
                </Badge>
                <span>Stream preview illustration</span>
              </div>
              <div className="stream-card-body">
                <h3>
                  {r.title}
                  <ArrowUpRight size={17} />
                </h3>
                <p className="mono">{r.id}</p>
                <div>
                  <span>
                    <Users size={14} />
                    {r.viewers} viewers
                  </span>
                  <span>{r.codec.replace("video/", "") || "Negotiating"}</span>
                  <span>Local SFU</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
export function OperationsPage() {
  const { rooms, error, ready } = useRooms();
  const total = rooms.reduce(
    (acc, r) => ({
      viewers: acc.viewers + r.viewers,
      bytes: acc.bytes + r.receivedBytes,
      dropped: acc.dropped + r.droppedPackets,
      packets: acc.packets + r.forwardedPackets,
    }),
    { viewers: 0, bytes: 0, dropped: 0, packets: 0 },
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">UNDER THE HOOD</div>
          <h1>Operations</h1>
          <p>A clear view of the infrastructure carrying your signal.</p>
        </div>
        <a
          className="button secondary"
          href="/metrics"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} />
          Prometheus metrics
        </a>
      </div>
      <div className="ops-summary">
        {[
          { label: "Active streams", value: rooms.length, icon: Radio },
          { label: "Connected viewers", value: total.viewers, icon: Users },
          {
            label: "Received media",
            value: `${(total.bytes / 1e6).toFixed(1)} MB`,
            icon: ArrowDownUp,
          },
          {
            label: "Impaired packets",
            value: total.dropped.toLocaleString(),
            icon: Activity,
          },
        ].map((x) => (
          <div className="panel ops-stat" key={x.label}>
            <x.icon size={19} />
            <span>{x.label}</span>
            <strong>{x.value}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            <Server size={16} />
            SFU nodes
          </h2>
          <Badge>Single-node deployment</Badge>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>NODE</th>
                <th>REGION</th>
                <th>STATUS</th>
                <th>STREAMS</th>
                <th>VIEWERS</th>
                <th>TRANSPORT</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="node-name">
                    <span className="node-icon">
                      <Server size={17} />
                    </span>
                    <strong>streamforge-local</strong>
                  </span>
                </td>
                <td>Local machine</td>
                <td>
                  <Badge tone={error ? "orange" : ready ? "green" : "neutral"}>
                    <StatusDot active={ready && !error} />
                    {error ? "Unreachable" : ready ? "Healthy" : "Checking"}
                  </Badge>
                </td>
                <td>{rooms.length} / 32</td>
                <td>{total.viewers}</td>
                <td>WebRTC · UDP</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <div className="ops-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Active sessions</h2>
            <Badge>{rooms.length} streams</Badge>
          </div>
          {rooms.length ? (
            rooms.map((r) => (
              <div key={r.id} className="session-row">
                <div className="session-icon">
                  <Radio size={17} />
                </div>
                <div>
                  <strong>{r.title}</strong>
                  <small>
                    {r.id} · {r.codec.replace("video/", "")}
                  </small>
                </div>
                <span>{r.viewers} viewers</span>
                <a
                  href={`/watch/${r.id}${r.viewerToken ? `#${encodeURIComponent(r.viewerToken)}` : ""}`}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-button"
                  aria-label={`Watch ${r.title}`}
                >
                  <ArrowUpRight size={17} />
                </a>
              </div>
            ))
          ) : (
            <Empty
              title="No active sessions"
              detail="Start a stream to see its transport and audience here."
            />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <Cpu size={16} />
              Capabilities
            </h2>
          </div>
          <div className="capabilities">
            {[
              ["RTP forwarding", "Available"],
              ["H.264 / VP8 / browser AV1", "Available"],
              ["NACK / PLI feedback", "Available"],
              ["NVIDIA GPU encoding", "Requires NVIDIA host"],
              ["TensorRT inference", "Roadmap"],
              ["Multi-region routing", "Roadmap"],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <Badge tone={value === "Available" ? "green" : "neutral"}>
                  {value}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
export function ArchitecturePage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUILT TO BE UNDERSTOOD</div>
          <h1>Behind the signal</h1>
          <p>One reliable stream first. Then everything that makes it scale.</p>
        </div>
        <Badge>Foundation · v0.1</Badge>
      </div>
      <section className="architecture-hero panel">
        <Badge tone="orange">THE STREAMFORGE PIPELINE</Badge>
        <h2>
          Small footprint.
          <br />
          Serious streaming.
        </h2>
        <p>
          Capture once, encode once, forward to every viewer. The SFU never
          decodes your frames.
        </p>
        <div className="architecture-flow">
          {[
            {
              icon: Camera,
              name: "Source",
              detail: "Browser or C++ / GStreamer",
            },
            { icon: Settings2, name: "Encoder", detail: "H.264 + Opus" },
            {
              icon: Server,
              name: "Go / Pion SFU",
              detail: "RTP forwarding + impairment",
            },
            { icon: Monitor, name: "Viewer", detail: "Browser WebRTC player" },
          ].map((x, i) => (
            <div className="architecture-node" key={x.name}>
              <x.icon size={25} />
              <strong>{x.name}</strong>
              <span>{x.detail}</span>
              {i < 3 && <ArrowRight className="architecture-arrow" size={19} />}
            </div>
          ))}
        </div>
      </section>
      <div className="architecture-details">
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <Check size={17} />
              Working foundation
            </h2>
            <Badge tone="green">IMPLEMENTED</Badge>
          </div>
          <ul className="feature-list">
            {[
              "React + TypeScript Studio and viewer",
              "WebSocket signaling: SDP and trickle ICE",
              "One publisher to many viewers through the SFU",
              "C++ GStreamer H.264 / Opus publisher",
              "Measured browser WebRTC telemetry",
              "Real packet impairment and adaptive quality",
              "Prometheus metrics and Grafana provisioning",
              "STUN / TURN configuration and Docker deployment",
            ].map((x) => (
              <li key={x}>
                <Check size={15} />
                {x}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <Layers size={17} />
              Next stages
            </h2>
            <Badge>ROADMAP</Badge>
          </div>
          <ul className="feature-list roadmap-list">
            {[
              ["09–10", "NVIDIA acceleration and codec benchmarks"],
              ["11–12", "Kafka event ingestion and Airflow analytics"],
              ["13", "TensorRT object detection and tracking"],
              ["14", "LL-HLS broadcast delivery"],
              ["15", "Regional routing and failure recovery"],
              ["16", "Controlled performance measurements"],
            ].map(([week, title]) => (
              <li key={week}>
                <span className="mono">{week}</span>
                {title}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="architecture-note">
        <BookOpen size={18} />
        <p>
          The MVP keeps signaling and the SFU in one Go process. The native
          capture and encoding engine is C++. This is a deliberate
          simplification of the proposed C++ SFU; the signaling protocol leaves
          room to replace the forwarding implementation later.
        </p>
      </div>
    </>
  );
}
export function SettingsPage() {
  const [config, setConfig] = useState<{
      iceServers: RTCIceServer[];
      region: string;
      maxViewers: number;
      authRequired: boolean;
      historyEnabled: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [token, setToken] = useState(operatorToken());
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/config", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Backend unavailable");
        return r.json();
      })
      .then(setConfig)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>Environment settings</h1>
          <p>Connection details for your local streaming environment.</p>
        </div>
        <Badge tone={config?.authRequired ? "green" : "neutral"}>
          {config?.authRequired ? "Access control enabled" : "Local open mode"}
        </Badge>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <Server size={16} />
              Server
            </h2>
          </div>
          <div className="settings-rows">
            {[
              ["Endpoint", location.origin],
              ["Signaling", "WebSocket /ws"],
              ["Media forwarding", "Pion WebRTC v4"],
              ["Region", config?.region ?? "Loading…"],
              ["Viewer limit per stream", config?.maxViewers ?? "—"],
              [
                "Persistent history",
                config?.historyEnabled ? "Enabled" : "Disabled",
              ],
              [
                "ICE servers",
                config?.iceServers.length
                  ? config.iceServers
                      .map((x) =>
                        Array.isArray(x.urls) ? x.urls.join(", ") : x.urls,
                      )
                      .join(", ")
                  : "Host candidates (local network)",
              ],
            ].map(([name, value]) => (
              <div key={name}>
                <span>{name}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <Settings2 size={16} />
              Operator access
            </h2>
          </div>
          <div className="settings-guide">
            <p>
              When server authentication is enabled, this token authorizes room
              management and publishing for this browser session.
            </p>
            <label className="field-label" htmlFor="operator-token">
              Operator token
            </label>
            <input
              id="operator-token"
              type="password"
              autoComplete="off"
              value={token}
              placeholder="STREAMFORGE_AUTH_SECRET"
              onChange={(event) => {
                setToken(event.target.value);
                setOperatorToken(event.target.value);
              }}
            />
            <p>
              The token stays in session storage and is cleared when the browser
              session ends.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <Globe size={16} />
              Beyond localhost
            </h2>
          </div>
          <div className="settings-guide">
            <p>
              Camera and microphone capture require a secure context. Use HTTPS
              when accessing StreamForge from another machine.
            </p>
            <p>
              Configure STUN and TURN in the server environment for connections
              across networks.
            </p>
            <code>
              STUN_URL
              <br />
              TURN_URL
              <br />
              TURN_SECRET
              <br />
              RTC_PUBLIC_IP
              <br />
              ALLOWED_ORIGINS
            </code>
            <p>
              See <strong>docs/deployment.md</strong> for setup, firewall ports,
              and the local development security model.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
