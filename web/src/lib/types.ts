export type Page =
  "studio" | "streams" | "lab" | "operations" | "architecture" | "settings";
export type Network = {
  bandwidthMbps: number;
  latencyMs: number;
  jitterMs: number;
  lossPercent: number;
};
export type Room = {
  publisherQoE?: { rtt: number; loss: number };
  viewerQoE?: { rtt: number; loss: number };
  id: string;
  title: string;
  startedAt: string;
  viewers: number;
  tracks: number;
  codec: string;
  network: Network;
  receivedBytes: number;
  forwardedPackets: number;
  droppedPackets: number;
};
export type Metrics = {
  timestamp: number;
  bitrate: number;
  fps: number;
  rtt: number;
  jitter: number;
  loss: number;
  width: number;
  height: number;
  frames: number;
  dropped: number;
  codec: string;
  encodeMs: number;
  decodeMs: number;
  nack: number;
  pli: number;
};
export type Event = {
  id: number;
  time: string;
  text: string;
  kind: "info" | "success" | "warning";
};
export type Source = "demo" | "camera" | "screen";
export type Quality = {
  label: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  scale: number;
};
export const HEALTHY: Network = {
  bandwidthMbps: 100,
  latencyMs: 0,
  jitterMs: 0,
  lossPercent: 0,
};
export const EMPTY_METRICS: Metrics = {
  timestamp: 0,
  bitrate: 0,
  fps: 0,
  rtt: 0,
  jitter: 0,
  loss: 0,
  width: 0,
  height: 0,
  frames: 0,
  dropped: 0,
  codec: "",
  encodeMs: 0,
  decodeMs: 0,
  nack: 0,
  pli: 0,
};
