import { describe, expect, it } from "vitest";
import { AdaptiveController } from "./adaptive";
import { HEALTHY } from "./types";
describe("adaptive controller", () => {
  it("steps down under packet loss and needs three healthy samples to recover", () => {
    const c = new AdaptiveController(3);
    expect(c.step({ ...HEALTHY, lossPercent: 8 }).quality.height).toBe(720);
    expect(c.step(HEALTHY).changed).toBe(false);
    expect(c.step(HEALTHY).changed).toBe(false);
    expect(c.step(HEALTHY).quality.fps).toBe(30);
    expect(c.level).toBe(2);
    c.step(HEALTHY);
    c.step(HEALTHY);
    expect(c.step(HEALTHY).quality.fps).toBe(60);
  });
  it("uses observed RTCP loss and RTT even without an injected profile", () => {
    const c = new AdaptiveController(3);
    expect(c.step(HEALTHY, 0, 6).quality.height).toBe(720);
    expect(c.step(HEALTHY, 600, 0).quality.height).toBe(360);
  });
  it("never exceeds the configured ceiling or recovers on intermittent good samples", () => {
    const c = new AdaptiveController(1);
    for (let i = 0; i < 10; i++) c.step(HEALTHY);
    expect(c.level).toBe(1);
    c.step({ ...HEALTHY, bandwidthMbps: 0.5 });
    c.step(HEALTHY);
    c.step(HEALTHY);
    c.step({ ...HEALTHY, bandwidthMbps: 0.5 });
    c.step(HEALTHY);
    expect(c.level).toBe(0);
  });
});
