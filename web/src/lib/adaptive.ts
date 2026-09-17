import type { Network, Quality } from "./types";
export const QUALITY_LEVELS: Quality[] = [
  {
    label: "360p",
    width: 640,
    height: 360,
    fps: 20,
    bitrate: 600_000,
    scale: 3,
  },
  {
    label: "720p",
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 1_800_000,
    scale: 1.5,
  },
  {
    label: "1080p",
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 3_500_000,
    scale: 1,
  },
  {
    label: "1080p",
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 6_000_000,
    scale: 1,
  },
];
// Immediate degradation; three healthy samples before a one-level recovery.
export class AdaptiveController {
  level: number;
  private healthy = 0;
  constructor(public ceiling = 2) {
    this.level = ceiling;
  }
  step(
    network: Network,
    rtt = 0,
    loss = 0,
  ): { quality: Quality; changed: boolean; reason: string } {
    const maxLoss = Math.max(network.lossPercent, loss);
    let target = this.ceiling;
    if (network.bandwidthMbps < 1 || maxLoss >= 15 || rtt > 500) target = 0;
    else if (network.bandwidthMbps < 3 || maxLoss >= 5 || rtt > 250)
      target = Math.min(target, 1);
    else if (network.bandwidthMbps < 5 || maxLoss >= 2 || rtt > 150)
      target = Math.min(target, 2);
    const previous = this.level;
    if (target < this.level) {
      this.level = target;
      this.healthy = 0;
    } else if (target > this.level) {
      if (++this.healthy >= 3) {
        this.level++;
        this.healthy = 0;
      }
    } else this.healthy = 0;
    return {
      quality: QUALITY_LEVELS[this.level],
      changed: previous !== this.level,
      reason:
        this.level < previous
          ? "Network pressure detected"
          : "Network recovered",
    };
  }
}
