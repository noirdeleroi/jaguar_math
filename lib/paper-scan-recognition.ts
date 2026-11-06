import jsQR from "jsqr";
import sharp from "sharp";
import {
  bubblePosition,
  CHOICES,
  MARKERS,
  parseQrPayload,
  QR,
  type BubbleReading,
  type ScanQuestion,
} from "./paper-scan-layout.ts";

type Point = { x: number; y: number };
type Raster = { data: Uint8Array; width: number; height: number };
export type Recognition = {
  identifier: ReturnType<typeof parseQrPayload>;
  readings: BubbleReading[];
  problem: string | null;
  normalized: Buffer | null;
  algorithm: string;
};
export const SCAN_ALGORITHM = "jm-omr-1.0";

// An eight-parameter projective map handles rotation, scale, skew and perspective.
export function homography(from: Point[], to: Point[]) {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const u = to[i].x;
    const v = to[i].y;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++)
      if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    if (Math.abs(a[c][c]) < 1e-9) throw new Error("Alignment is degenerate");
    const d = a[c][c];
    for (let k = c; k < 9; k++) a[c][k] /= d;
    for (let r = 0; r < 8; r++)
      if (r !== c) {
        const f = a[r][c];
        for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k];
      }
  }
  const h = a.map((row) => row[8]);
  return ({ x, y }: Point): Point => {
    const z = h[6] * x + h[7] * y + 1;
    return {
      x: (h[0] * x + h[1] * y + h[2]) / z,
      y: (h[3] * x + h[4] * y + h[5]) / z,
    };
  };
}

function sample(raster: Raster, p: Point) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return 0;
  return raster.data[y * raster.width + x];
}

function findMarker(
  raster: Raster,
  prediction: Point,
  scale: number,
): Point | null {
  const radius = Math.round(45 * scale);
  const x0 = Math.max(0, Math.round(prediction.x) - radius);
  const y0 = Math.max(0, Math.round(prediction.y) - radius);
  const x1 = Math.min(raster.width, x0 + 2 * radius);
  const y1 = Math.min(raster.height, y0 + 2 * radius);
  if (x1 <= x0 || y1 <= y0) return null;
  const w = x1 - x0;
  const h = y1 - y0;
  const seen = new Uint8Array(w * h);
  const candidates: { point: Point; distance: number }[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (seen[start] || raster.data[(y0 + y) * raster.width + x0 + x] >= 100)
        continue;
      const queue = [start];
      seen[start] = 1;
      let head = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sx = 0;
      let sy = 0;
      while (head < queue.length) {
        const index = queue[head++];
        const px = index % w;
        const py = Math.floor(index / w);
        sx += px;
        sy += py;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
        for (const [nx, ny] of [
          [px - 1, py],
          [px + 1, py],
          [px, py - 1],
          [px, py + 1],
        ]) {
          const ni = ny * w + nx;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || seen[ni]) continue;
          seen[ni] = 1;
          if (raster.data[(y0 + ny) * raster.width + x0 + nx] < 100)
            queue.push(ni);
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      // Rotated squares can have a bounding-box fill ratio near one half.
      if (
        bw < 8 * scale ||
        bh < 8 * scale ||
        bw > 20 * scale ||
        bh > 20 * scale ||
        bw / bh < 0.7 ||
        bw / bh > 1.43 ||
        queue.length / (bw * bh) < 0.48
      )
        continue;
      const point = { x: x0 + sx / queue.length, y: y0 + sy / queue.length };
      candidates.push({
        point,
        distance: Math.hypot(point.x - prediction.x, point.y - prediction.y),
      });
    }
  candidates.sort((a, b) => a.distance - b.distance);
  if (
    !candidates.length ||
    (candidates[1] &&
      candidates[1].distance < candidates[0].distance + 5 * scale)
  )
    return null;
  return candidates[0].point;
}

export function classifyBubble(
  densities: number[],
  quadrants: number[],
  outside: number[],
  darkInk = densities,
): Omit<BubbleReading, "position"> {
  const ranked = densities
    .map((density, index) => ({ density, index }))
    .sort((a, b) => b.density - a.density);
  const strongest = ranked[0];
  const runnerUp = ranked[1];
  const status =
    strongest.density < 0.025
      ? "blank"
      : runnerUp.density >= 0.22
        ? "multiple"
        : strongest.density < 0.72 ||
            darkInk[strongest.index] < 0.55 ||
            runnerUp.density > 0.055
          ? "faint"
          : quadrants[strongest.index] < 0.48 ||
              outside.some((value) => value > 0.035)
            ? "irregular"
            : "clear";
  return {
    choice: status === "clear" ? CHOICES[strongest.index] : null,
    status,
    densities: densities.map((d) => Math.round(d * 1000) / 1000),
  };
}

export async function identifyScan(bytes: Buffer) {
  const { data, info } = await sharp(bytes, { limitInputPixels: 25_000_000 })
    .rotate()
    .resize({
      width: 2200,
      height: 2600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "white" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
    inversionAttempts: "dontInvert",
  });
  return {
    qr,
    identifier: qr ? parseQrPayload(qr.data) : null,
    rgba: data,
    width: info.width,
    height: info.height,
  };
}

export async function recognizeScan(
  bytes: Buffer,
  questions: ScanQuestion[],
  expectedToken?: string,
  forcedRotation?: number,
): Promise<Recognition> {
  const found = await identifyScan(bytes);
  const fail = (problem: string): Recognition => ({
    identifier: found.identifier,
    readings: questions.map((q) => ({
      position: q.position,
      choice: null,
      status: "unreadable",
      densities: [],
    })),
    problem,
    normalized: null,
    algorithm: SCAN_ALGORITHM,
  });
  if (!found.identifier && forcedRotation === undefined)
    return fail(
      "QR code unreadable. Select the printed student sheet and page to review manually, or rescan.",
    );
  if (
    expectedToken &&
    found.identifier &&
    found.identifier.token !== expectedToken
  )
    return fail("The QR code belongs to a different sheet.");
  const gray = new Uint8Array(found.width * found.height);
  for (let i = 0; i < gray.length; i++)
    gray[i] = Math.round(
      found.rgba[i * 4] * 0.299 +
        found.rgba[i * 4 + 1] * 0.587 +
        found.rgba[i * 4 + 2] * 0.114,
    );
  const raster = { data: gray, width: found.width, height: found.height };
  const quiet = (QR.quiet * QR.size) / (QR.modules + QR.quiet * 2);
  const qrSource = [
    { x: QR.x + quiet, y: QR.y + quiet },
    { x: QR.x + QR.size - quiet, y: QR.y + quiet },
    { x: QR.x + QR.size - quiet, y: QR.y + QR.size - quiet },
    { x: QR.x + quiet, y: QR.y + QR.size - quiet },
  ];
  let predict: (p: Point) => Point;
  if (found.qr && found.identifier) {
    const l = found.qr.location;
    // Extrapolating a projective fit from a small QR magnifies subpixel corner
    // noise over the full page. Use an affine finder-pattern estimate to locate
    // the widely spaced registration squares, then fit perspective to those.
    const unit = QR.size / (QR.modules + QR.quiet * 2);
    const a = { x: QR.x + quiet + 3.5 * unit, y: QR.y + quiet + 3.5 * unit };
    const b = { x: QR.x + quiet + (QR.modules - 3.5) * unit, y: a.y };
    const c = { x: a.x, y: QR.y + quiet + (QR.modules - 3.5) * unit };
    const tl = l.topLeftFinderPattern;
    const tr = l.topRightFinderPattern;
    const bl = l.bottomLeftFinderPattern;
    predict = homography(
      [a, b, { x: b.x, y: c.y }, c],
      [tl, tr, { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y }, bl],
    );
  } else {
    const corners = [
      { x: 0, y: 0 },
      { x: found.width, y: 0 },
      { x: found.width, y: found.height },
      { x: 0, y: found.height },
    ];
    const offset = ((forcedRotation ?? 0) / 90) % 4;
    predict = homography(
      [
        { x: 0, y: 0 },
        { x: 595.28, y: 0 },
        { x: 595.28, y: 841.89 },
        { x: 0, y: 841.89 },
      ],
      corners.map((_, i) => corners[(i + offset) % 4]),
    );
  }
  const scale = Math.hypot(
    predict({ x: 100, y: 100 }).x - predict({ x: 101, y: 100 }).x,
    predict({ x: 100, y: 100 }).y - predict({ x: 101, y: 100 }).y,
  );
  if (scale < 1.2)
    return fail("Scan resolution is too low. Scan at 200-300 dpi.");
  const markers = MARKERS.map((p) => findMarker(raster, predict(p), scale));
  if (markers.some((p) => !p))
    return fail(
      "All four alignment squares must be clear and visible. Rescan or review manually.",
    );
  const map = homography(MARKERS, markers as Point[]);
  if (
    found.qr &&
    found.identifier &&
    qrSource.some(
      (p) =>
        Math.hypot(map(p).x - predict(p).x, map(p).y - predict(p).y) / scale >
        3,
    )
  )
    return fail(
      "QR and alignment squares disagree. Rescan or review manually.",
    );
  const readings: BubbleReading[] = questions.map((question, i) => {
    const densities: number[] = [];
    const quadrants: number[] = [];
    const outside: number[] = [];
    const darkInk: number[] = [];
    for (let c = 0; c < 4; c++) {
      const center = bubblePosition(i, c);
      let dark = 0;
      let deep = 0;
      let total = 0;
      let outerDark = 0;
      let outerTotal = 0;
      const qDark = [0, 0, 0, 0];
      const qTotal = [0, 0, 0, 0];
      for (let dy = -9; dy <= 9; dy += 0.5)
        for (let dx = -9; dx <= 9; dx += 0.5) {
          const r = Math.hypot(dx, dy);
          if (r > 9 || (r > 4.3 && r < 7.5)) continue;
          const v = sample(raster, map({ x: center.x + dx, y: center.y + dy }));
          if (r <= 4.3) {
            const q = (dx >= 0 ? 1 : 0) + (dy >= 0 ? 2 : 0);
            total++;
            qTotal[q]++;
            if (v < 110) deep++;
            if (v < 170) {
              dark++;
              qDark[q]++;
            }
          } else {
            outerTotal++;
            if (v < 160) outerDark++;
          }
        }
      densities.push(dark / total);
      darkInk.push(deep / total);
      quadrants.push(Math.min(...qDark.map((n, q) => n / qTotal[q])));
      outside.push(outerDark / outerTotal);
    }
    return {
      position: question.position,
      ...classifyBubble(densities, quadrants, outside, darkInk),
    };
  });
  const width = 1191;
  const height = 1684;
  const normalized = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      normalized[y * width + x] = sample(raster, map({ x: x / 2, y: y / 2 }));
  return {
    identifier: found.identifier,
    readings,
    problem:
      forcedRotation !== undefined
        ? "Manually identified sheet: confirm every answer before finalization."
        : null,
    normalized: await sharp(normalized, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer(),
    algorithm: SCAN_ALGORITHM,
  };
}
