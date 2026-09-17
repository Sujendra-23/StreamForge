import { useEffect, useRef } from "react";
import { ArrowUpRight, Check, Circle, Radio, X } from "lucide-react";
import { drawScene } from "../lib/demo";
import type { Metrics } from "../lib/types";
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-icon">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2 5 14h7l-2 8L20 9h-7z" />
        </svg>
      </span>
      {!small && (
        <span>
          streamforge<span className="brand-period">.</span>
        </span>
      )}
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function StatusDot({ active = false }: { active?: boolean }) {
  return <span className={`status-dot ${active ? "active" : ""}`} />;
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`toggle ${checked ? "on" : ""}`}
    >
      <span />
    </button>
  );
}
export function Scene({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    drawScene(canvas, performance.now());
    if (reduced) return;
    const timer = setInterval(
      () => drawScene(canvas, performance.now()),
      1000 / 24,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <canvas
      ref={ref}
      width={1280}
      height={720}
      className={className}
      aria-label="Animated mountain landscape test source"
    />
  );
}
export function Video({
  stream,
  muted = true,
  className = "",
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      void ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <video ref={ref} autoPlay playsInline muted={muted} className={className} />
  );
}
export function Sparkline({
  values,
  color = "#f16c42",
  fill = false,
  label = "Metric trend",
}: {
  values: number[];
  color?: string;
  fill?: boolean;
  label?: string;
}) {
  const max = Math.max(...values, 1) * 1.15,
    points = values
      .map(
        (v, i) =>
          `${(i / Math.max(values.length - 1, 1)) * 300},${55 - (v / max) * 48}`,
      )
      .join(" ");
  return (
    <svg
      viewBox="0 0 300 60"
      preserveAspectRatio="none"
      className="sparkline"
      role="img"
      aria-label={label}
    >
      {values.length < 2 ? (
        <path d="M0 48H300" stroke="#d9dee4" strokeDasharray="4 5" />
      ) : (
        <>
          {fill && (
            <polygon
              points={`0,60 ${points} 300,60`}
              fill={color}
              opacity=".08"
            />
          )}
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}
export function MetricCard({
  label,
  value,
  unit,
  values,
  color,
  detail,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  values: number[];
  color?: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <Sparkline values={values} color={color} label={`${label} over time`} />
      <div className="metric-detail">
        <span style={{ background: color || "#f16c42" }} />
        {detail}
      </div>
    </div>
  );
}
export function ErrorBanner({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  return text ? (
    <div className="error-banner" role="alert">
      <Circle size={15} />
      <span>{text}</span>
      <button aria-label="Dismiss error" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  ) : null;
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Radio size={25} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function downloadMetrics(history: Metrics[]) {
  const headers = Object.keys(history[0] || {});
  if (!headers.length) return;
  const blob = new Blob(
    [
      [
        headers.join(","),
        ...history.map((row) =>
          headers.map((k) => row[k as keyof Metrics]).join(","),
        ),
      ].join("\n"),
    ],
    { type: "text/csv" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `streamforge-telemetry-${Date.now()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function HealthCheck({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="health-check">
      <span>
        {ok ? <Check size={14} /> : <Circle size={12} />} {label}
      </span>
      <span>{value}</span>
    </div>
  );
}
export function ExternalLabel({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ArrowUpRight size={14} />
    </>
  );
}
