// A local, animated test pattern: no downloaded footage, device access, or fake statistics.
export function drawScene(canvas: HTMLCanvasElement, time: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width,
    h = canvas.height;
  const t = time / 1000;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#132a30");
  sky.addColorStop(0.5, "#557874");
  sky.addColorStop(1, "#c1b298");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(
    w * 0.72,
    h * 0.26,
    0,
    w * 0.72,
    h * 0.26,
    h * 0.42,
  );
  glow.addColorStop(0, "#f9e6bf88");
  glow.addColorStop(1, "#f9e6bf00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#f5e2bc";
  ctx.beginPath();
  ctx.arc(w * 0.72, h * 0.27, h * 0.063, 0, Math.PI * 2);
  ctx.fill();
  for (let layer = 0; layer < 6; layer++) {
    const base = h * (0.35 + layer * 0.105),
      amp = h * (0.24 - layer * 0.025);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) {
      const n = x / w;
      const y =
        base -
        amp *
          (Math.sin(n * 6.4 + layer * 1.9) * 0.52 +
            Math.sin(n * 14.8 + layer) * 0.3 +
            Math.sin(n * 30.1 + layer * 3) * 0.1);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = [
      "#829b91",
      "#64857d",
      "#40685f",
      "#244b45",
      "#153b37",
      "#0c2727",
    ][layer];
    ctx.fill();
  }
  // Soft drifting fog bands make the pattern useful for testing motion and encoding.
  for (let i = 0; i < 3; i++) {
    const x = ((t * (8 + i * 3) + i * w * 0.4) % (w * 1.8)) - w * 0.4;
    const fog = ctx.createRadialGradient(
      x,
      h * (0.58 + i * 0.09),
      0,
      x,
      h * (0.58 + i * 0.09),
      w * 0.35,
    );
    fog.addColorStop(0, "#dce9d612");
    fog.addColorStop(1, "#dce9d600");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = "#ffffffba";
  ctx.font = `500 ${Math.round(w * 0.01)}px monospace`;
  ctx.fillText("STREAMFORGE  /  SIGNAL 01", w * 0.045, h * 0.9);
  ctx.textAlign = "right";
  ctx.fillText(new Date().toISOString().slice(11, 23), w * 0.955, h * 0.9);
  ctx.textAlign = "left";
  ctx.fillStyle = "#edf0da";
  ctx.beginPath();
  ctx.arc(w * (0.5 + 0.28 * Math.sin(t * 0.35)), h * 0.78, 4, 0, Math.PI * 2);
  ctx.fill();
}
export function createDemoStream(width = 1920, height = 1080, fps = 30) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  drawScene(canvas, performance.now());
  const timer = window.setInterval(
    () => drawScene(canvas, performance.now()),
    1000 / fps,
  );
  const stream = canvas.captureStream(fps);
  return {
    stream,
    cleanup: () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
