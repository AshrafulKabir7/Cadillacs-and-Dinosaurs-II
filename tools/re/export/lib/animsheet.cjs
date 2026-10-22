// Render animation rows: each row = label + frames (feet-origin aligned) with durations.
'use strict';
const { Canvas } = require('./draw.cjs');
// paint one hero frame (12/10-byte frame object from hero-static) with feet at (fx, fy)
function paintFrame(cv, f, fx, fy, opt = {}) {
  const mir = !!opt.mirror, s = mir ? -1 : 1;
  if (f.composite) { for (let k = (f.parts || []).length - 1; k >= 0; k--) { const p = f.parts[k]; cv.record(p.rec, fx + s * p.dx, fy - p.dy, opt); } return; }
  if (f.rec2 != null) cv.record(f.rec2, fx, fy, opt);
  if (f.rec != null) cv.record(f.rec, fx, fy, opt);
}
function sheet(rows, { cellW = 96, cellH = 120, labelW = 220, maxCols = 16, bg = [36, 40, 48, 255], scale = 1 } = {}) {
  const cols = Math.min(maxCols, Math.max(1, ...rows.map(r => r.frames.length)));
  const lines = rows.map(r => Math.max(1, Math.ceil(r.frames.length / cols)));
  const H = lines.reduce((a, b) => a + b, 0) * cellH, W = labelW + cols * cellW;
  const cv = new Canvas(W, H, bg);
  let y = 0;
  rows.forEach((r, ri) => {
    cv.fill(0, y, W, 1, [70, 74, 84, 255]);
    const t = (r.label || '').match(/.{1,35}/g) || [''];
    t.forEach((s, k) => cv.text(s, 4, y + 4 + k * 10, [255, 255, 160]));
    (r.notes || []).forEach((s, k) => cv.text(s, 4, y + 4 + (t.length + k) * 10, [170, 200, 255]));
    r.frames.forEach((f, i) => {
      const cx = labelW + (i % cols) * cellW, cy = y + Math.floor(i / cols) * cellH, fx = cx + Math.floor(cellW / 2), fy = cy + cellH - 14;
      cv.fill(cx, cy, 1, cellH, [56, 60, 70, 255]);
      paintFrame(cv, f, fx, fy, { clip: [cx + 1, cy + 1, cellW - 1, cellH - 1] });
      cv.cross(fx, fy);
      cv.text(f.caption != null ? f.caption : `${f.rec != null ? f.rec : 'C'}${f.rec2 != null ? '+' + f.rec2 : ''}/${f.dur}`, cx + 2, cy + cellH - 10, [200, 200, 200]);
      if (f.hold != null && f.hold >= 0) cv.text('H' + f.hold.toString(16), cx + 2, cy + 2, [120, 255, 160]);
    });
    y += lines[ri] * cellH;
  });
  return cv;
}
module.exports = { sheet, paintFrame };
