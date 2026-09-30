import { WAVE_WIDTH_FRAC } from "./waveform";

export { WAVE_WIDTH_FRAC };

export type WaveDrawSample = { pos: number; amp: number };

export type WaveDrawStyle = {
  /** Lane/instrument hex color — tints the envelope instead of default cyan */
  tintColor?: string;
  /** Scales envelope opacity (0–1) */
  intensity?: number;
};

function hexToRgb(hex: string): [number, number, number] {
  // Accept both "#rrggbb" and "rgb(r,g,b)" (mobile call sites pass the latter).
  if (hex.startsWith("rgb")) {
    const parts = hex.match(/\d+/g);
    if (parts && parts.length >= 3) {
      return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
    }
  }
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function enrichWaveSamples(samples: WaveDrawSample[]): WaveDrawSample[] {
  if (samples.length < 2) return samples;

  const sorted = [...samples].sort((a, b) => a.pos - b.pos);
  const out: WaveDrawSample[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    out.push(a);

    const gap = b.pos - a.pos;
    if (gap <= 3) continue;

    const steps = Math.min(6, Math.max(2, Math.floor(gap / 3)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const amp = a.amp + (b.amp - a.amp) * t;
      out.push({
        pos: a.pos + gap * t,
        amp: amp * (0.92 + 0.08 * Math.sin(t * Math.PI)),
      });
    }
  }

  out.push(sorted[sorted.length - 1]);
  return out;
}

/**
 * Ableton-style lane waveform: a solid, flat fill in the lane color with a
 * darker edge outline — no glow, no lens line. Past renders fuller, future
 * stays readable. Strong transients still get an accent tick.
 */
export function drawLaneWaveStroke(
  ctx: CanvasRenderingContext2D,
  samples: WaveDrawSample[],
  cx: number,
  maxHalf: number,
  mode: "past" | "future",
  style: WaveDrawStyle = {}
) {
  const tint = style.tintColor;
  const intensity = style.intensity ?? 1;
  const visible = enrichWaveSamples(
    samples
      .filter((s) => s.amp >= 0.01)
      .map((s) => ({ pos: s.pos, amp: Math.min(1, s.amp) }))
  );
  if (visible.length < 2) return;

  // Transient exaggeration — spike each sample by its excess over the local
  // average so plosives tower over the body of the waveform instead of
  // blending in. Boosted amps drive both the fill shape and the accent ticks.
  const n = visible.length;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let d = -3; d <= 3; d++) {
      const j = i + d;
      if (j < 0 || j >= n) continue;
      sum += visible[j].amp;
      count++;
    }
    const localAvg = sum / Math.max(1, count);
    const spike = Math.max(0, visible[i].amp - localAvg);
    if (spike > 0) visible[i].amp = Math.min(1, visible[i].amp + spike * 1.8);
  }

  const halves = visible.map((sample) => ({
    pos: sample.pos,
    half: Math.max(2, Math.pow(sample.amp, 0.9) * maxHalf),
  }));

  // Closed mirrored shape: out along the top edge, back along the bottom.
  const shape = new Path2D();
  halves.forEach((point, i) => {
    if (i === 0) shape.moveTo(cx + point.half, point.pos);
    else shape.lineTo(cx + point.half, point.pos);
  });
  for (let i = halves.length - 1; i >= 0; i--) {
    shape.lineTo(cx - halves[i].half, halves[i].pos);
  }
  shape.closePath();

  const past = mode === "past";

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Solid flat fill.
  ctx.fillStyle = tint
    ? rgba(tint, (past ? 0.42 : 0.24) * intensity)
    : past
      ? "rgba(0, 190, 230, 0.38)"
      : "rgba(60, 90, 130, 0.22)";
  ctx.fill(shape);

  // Darker edge outline — the Ableton look.
  if (tint) {
    const [r, g, b] = hexToRgb(tint);
    ctx.strokeStyle = `rgba(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)},${(past ? 0.9 : 0.65) * intensity})`;
  } else {
    ctx.strokeStyle = past
      ? "rgba(0, 110, 150, 0.9)"
      : "rgba(40, 60, 90, 0.6)";
  }
  ctx.lineWidth = 1;
  ctx.stroke(shape);

  // Transient accents — strong pops get a tick across the lane.
  if (tint) {
    ctx.lineWidth = past ? 1.75 : 1.25;
    for (let i = 0; i < visible.length; i++) {
      const amp = visible[i].amp;
      if (amp < 0.38) continue;
      const a =
        (past ? 0.7 : 0.4) *
        intensity *
        Math.min(1, (amp - 0.35) / 0.6);
      ctx.strokeStyle = rgba(tint, a);
      ctx.beginPath();
      ctx.moveTo(cx - halves[i].half - 3, halves[i].pos);
      ctx.lineTo(cx + halves[i].half + 3, halves[i].pos);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Mirrored cyan envelope — shared by highway and song scrollbar */
export function drawMirroredWaveEnvelope(
  ctx: CanvasRenderingContext2D,
  samples: WaveDrawSample[],
  cx: number,
  maxHalf: number,
  mode: "past" | "future",
  style: WaveDrawStyle = {}
) {
  const tint = style.tintColor;
  const intensity = style.intensity ?? 1;
  const visible = enrichWaveSamples(
    samples
      .filter((s) => s.amp >= 0.01)
      .map((s) => ({ pos: s.pos, amp: Math.min(1, s.amp) }))
  );
  if (visible.length < 2) return;

  const halves = visible.map((sample) => ({
    pos: sample.pos,
    // Higher floor keeps quiet transients visible instead of flickering out.
    half: Math.max(2, Math.pow(sample.amp, 0.9) * maxHalf),
  }));

  const topPath = new Path2D();
  const botPath = new Path2D();
  const glowTop = new Path2D();
  const glowBot = new Path2D();

  halves.forEach((point, i) => {
    const xR = cx + point.half;
    const xL = cx - point.half;
    const gR = cx + point.half * 1.16;
    const gL = cx - point.half * 1.16;

    if (i === 0) {
      topPath.moveTo(cx, point.pos);
      botPath.moveTo(cx, point.pos);
      glowTop.moveTo(cx, point.pos);
      glowBot.moveTo(cx, point.pos);
    }
    topPath.lineTo(xR, point.pos);
    botPath.lineTo(xL, point.pos);
    glowTop.lineTo(gR, point.pos);
    glowBot.lineTo(gL, point.pos);
  });

  for (let i = halves.length - 1; i >= 0; i--) {
    topPath.lineTo(cx, halves[i].pos);
    botPath.lineTo(cx, halves[i].pos);
    glowTop.lineTo(cx, halves[i].pos);
    glowBot.lineTo(cx, halves[i].pos);
  }

  topPath.closePath();
  botPath.closePath();
  glowTop.closePath();
  glowBot.closePath();

  const minY = halves[0].pos;
  const maxY = halves[halves.length - 1].pos;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (mode === "past") {
    ctx.shadowColor = tint ? rgba(tint, 0.45 * intensity) : "rgba(0, 220, 255, 0.45)";
    ctx.shadowBlur = tint ? 12 : 18;
    ctx.fillStyle = tint ? rgba(tint, 0.12 * intensity) : "rgba(0, 180, 220, 0.12)";
    ctx.fill(glowTop);
    ctx.fill(glowBot);
    ctx.shadowBlur = 0;

    const bodyGrad = ctx.createLinearGradient(cx - maxHalf, 0, cx + maxHalf, 0);
    if (tint) {
      bodyGrad.addColorStop(0, rgba(tint, 0.08 * intensity));
      bodyGrad.addColorStop(0.22, rgba(tint, 0.42 * intensity));
      bodyGrad.addColorStop(0.5, rgba(tint, 0.72 * intensity));
      bodyGrad.addColorStop(0.78, rgba(tint, 0.42 * intensity));
      bodyGrad.addColorStop(1, rgba(tint, 0.08 * intensity));
    } else {
      bodyGrad.addColorStop(0, "rgba(0, 170, 220, 0.1)");
      bodyGrad.addColorStop(0.22, "rgba(0, 230, 255, 0.55)");
      bodyGrad.addColorStop(0.5, "rgba(210, 255, 255, 0.92)");
      bodyGrad.addColorStop(0.78, "rgba(0, 230, 255, 0.55)");
      bodyGrad.addColorStop(1, "rgba(0, 170, 220, 0.1)");
    }
    ctx.fillStyle = bodyGrad;
    ctx.fill(topPath);
    ctx.fill(botPath);

    const coreGrad = ctx.createLinearGradient(cx - maxHalf * 0.35, 0, cx + maxHalf * 0.35, 0);
    if (tint) {
      coreGrad.addColorStop(0, rgba(tint, 0));
      coreGrad.addColorStop(0.5, rgba(tint, 0.48 * intensity));
      coreGrad.addColorStop(1, rgba(tint, 0));
    } else {
      coreGrad.addColorStop(0, "rgba(120, 240, 255, 0)");
      coreGrad.addColorStop(0.5, "rgba(220, 255, 255, 0.62)");
      coreGrad.addColorStop(1, "rgba(120, 240, 255, 0)");
    }
    ctx.fillStyle = coreGrad;

    const coreTop = new Path2D();
    const coreBot = new Path2D();
    halves.forEach((point, i) => {
      const coreHalf = point.half * 0.42;
      const xR = cx + coreHalf;
      const xL = cx - coreHalf;
      if (i === 0) {
        coreTop.moveTo(cx, point.pos);
        coreBot.moveTo(cx, point.pos);
      }
      coreTop.lineTo(xR, point.pos);
      coreBot.lineTo(xL, point.pos);
    });
    for (let i = halves.length - 1; i >= 0; i--) {
      coreTop.lineTo(cx, halves[i].pos);
      coreBot.lineTo(cx, halves[i].pos);
    }
    coreTop.closePath();
    coreBot.closePath();
    ctx.fill(coreTop);
    ctx.fill(coreBot);
  } else {
    const grad = ctx.createLinearGradient(cx - maxHalf, 0, cx + maxHalf, 0);
    if (tint) {
      // Upcoming audio stays clearly readable per lane while mapping (not just dim).
      grad.addColorStop(0, rgba(tint, 0.05 * intensity));
      grad.addColorStop(0.5, rgba(tint, 0.38 * intensity));
      grad.addColorStop(1, rgba(tint, 0.05 * intensity));
    } else {
      grad.addColorStop(0, "rgba(35, 55, 80, 0.08)");
      grad.addColorStop(0.5, "rgba(65, 95, 130, 0.42)");
      grad.addColorStop(1, "rgba(35, 55, 80, 0.08)");
    }
    ctx.fillStyle = grad;
    ctx.fill(topPath);
    ctx.fill(botPath);
  }

  ctx.restore();

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = tint
    ? rgba(tint, (mode === "past" ? 0.46 : 0.38) * intensity)
    : mode === "past"
      ? "rgba(255, 210, 80, 0.5)"
      : "rgba(80, 110, 150, 0.4)";
  ctx.lineWidth = mode === "past" ? 1.25 : 1;

  ctx.beginPath();
  halves.forEach((point, i) => {
    const x = cx - point.half;
    if (i === 0) ctx.moveTo(x, point.pos);
    else ctx.lineTo(x, point.pos);
  });
  ctx.stroke();

  ctx.beginPath();
  halves.forEach((point, i) => {
    const x = cx + point.half;
    if (i === 0) ctx.moveTo(x, point.pos);
    else ctx.lineTo(x, point.pos);
  });
  ctx.stroke();
  ctx.restore();

  if (mode === "past" && !tint) {
    ctx.save();
    const spineGrad = ctx.createLinearGradient(0, minY, 0, maxY);
    spineGrad.addColorStop(0, "rgba(160, 240, 255, 0)");
    spineGrad.addColorStop(0.12, "rgba(200, 255, 255, 0.22)");
    spineGrad.addColorStop(0.5, "rgba(220, 255, 255, 0.38)");
    spineGrad.addColorStop(0.88, "rgba(200, 255, 255, 0.22)");
    spineGrad.addColorStop(1, "rgba(160, 240, 255, 0)");
    ctx.strokeStyle = spineGrad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    halves.forEach((point, i) => {
      if (i === 0) ctx.moveTo(cx, point.pos);
      else ctx.lineTo(cx, point.pos);
    });
    ctx.stroke();
    ctx.restore();
  }
}