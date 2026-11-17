import jsQR, { type QRCode } from "jsqr";
import sharp from "sharp";
import { markConfidence } from "./paper-scan-confidence.ts";
import { SCAN_ALGORITHM } from "./paper-scan-version.ts";
export { SCAN_ALGORITHM } from "./paper-scan-version.ts";
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
  // Human-review evidence only. Never used to classify or finalize answers.
  reviewPreview?: Buffer;
  algorithm: string;
  alignment?: {
    qrCornerErrors: number[];
    scale: number;
    markers: (Point | null)[];
    markerCount: number;
    rows: { x: number; y: number; contrast: number; support: number }[];
  };
};

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

// Three distant registration squares constrain a flatbed scan's affine map.
// The QR and printed rings must independently verify this fallback below.
function affineMap(from: Point[], to: Point[]) {
  const u = { x: from[1].x - from[0].x, y: from[1].y - from[0].y };
  const v = { x: from[2].x - from[0].x, y: from[2].y - from[0].y };
  const determinant = u.x * v.y - u.y * v.x;
  if (Math.abs(determinant) < 1e-9) throw new Error("Alignment is degenerate");
  return (point: Point): Point => {
    const x = point.x - from[0].x, y = point.y - from[0].y;
    const a = (x * v.y - y * v.x) / determinant;
    const b = (u.x * y - u.y * x) / determinant;
    return { x: to[0].x + a * (to[1].x - to[0].x) + b * (to[2].x - to[0].x), y: to[0].y + a * (to[1].y - to[0].y) + b * (to[2].y - to[0].y) };
  };
}

function sample(raster: Raster, p: Point) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return 0;
  return raster.data[y * raster.width + x];
}
async function normalizeReviewRaster(raster: Raster, map: (p: Point) => Point) {
  const width = 1191,
    height = 1684;
  const normalized = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      normalized[y * width + x] = sample(raster, map({ x: x / 2, y: y / 2 }));
  return sharp(normalized, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

function refineBubbleRow(
  raster: Raster,
  map: (point: Point) => Point,
  index: number,
) {
  let best = { x: 0, y: 0, contrast: 0, support: 0 };
  let bestScore = -Infinity;
  // Register local feed distortion against the *outline*, not the filled mark.
  // Four points remain well below half the 17pt row / 39pt choice spacing.
  // At least two independent empty outlines support a normal single/double mark.
  for (let y = -4; y <= 4; y += 0.5)
    for (let x = -4; x <= 4; x += 0.5) {
      const rings = CHOICES.map((_, c) => {
        const center = bubblePosition(index, c);
        let ink = 0, inner = 0, outer = 0;
        for (let angle = 0; angle < 24; angle++) {
          const theta = (angle * Math.PI) / 12;
          const darkness = (radius: number) => 1 - sample(raster, map({ x: center.x + x + radius * Math.cos(theta), y: center.y + y + radius * Math.sin(theta) })) / 255;
          ink += darkness(6.2);
          inner += darkness(3);
          outer += darkness(8.5);
        }
        return (ink - .5 * inner - .5 * outer) / 24;
      }).sort((a, b) => b - a);
      const contrast = (rings[0] + rings[1]) / 2;
      const score = contrast - 0.002 * (x * x + y * y);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, contrast, support: rings[1] };
      }
    }
  return best;
}

function findMarker(
  raster: Raster,
  prediction: Point,
  scale: number,
): Point | null {
  const radius = Math.round(45 * scale);
  const x0 = Math.max(0, Math.round(prediction.x) - radius);
  const y0 = Math.max(0, Math.round(prediction.y) - radius);
  const x1 = Math.min(raster.width, Math.round(prediction.x) + radius + 1);
  const y1 = Math.min(raster.height, Math.round(prediction.y) + radius + 1);
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
      // Rotation and monochrome halftoning can reduce the connected ink below
      // half the bounding box. Size, shape, position and QR agreement also gate it.
      if (
        bw < 8 * scale ||
        bh < 8 * scale ||
        bw > 20 * scale ||
        bh > 20 * scale ||
        bw / bh < 0.7 ||
        bw / bh > 1.43 ||
        queue.length / (bw * bh) < 0.4
      )
        continue;
      const point = { x: x0 + sx / queue.length, y: y0 + sy / queue.length };
      const distance = Math.hypot(point.x - prediction.x, point.y - prediction.y);
      if (distance > radius) continue;
      candidates.push({
        point,
        distance,
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
): Omit<BubbleReading, "position"> {
  const ranked = densities
    .map((density, index) => ({ density, index }))
    .sort((a, b) => b.density - a.density);
  const strongest = ranked[0];
  const runnerUp = ranked[1];
  const dominant =
    strongest.density >= 0.12 &&
    strongest.density - runnerUp.density >= 0.1 &&
    runnerUp.density <= Math.max(0.08, strongest.density * 0.2);
  const crossed =
    outside[strongest.index] > 0.09 &&
    quadrants[strongest.index] < 0.75 &&
    strongest.density < 0.6;
  const status =
    strongest.density < 0.025
      ? "blank"
      : runnerUp.density >= 0.18 && runnerUp.density >= strongest.density * 0.35
        ? "multiple"
        : crossed
          ? "irregular"
          : dominant
            ? "clear"
            : "faint";
  return {
    choice: status === "clear" ? CHOICES[strongest.index] : null,
    ...(status === "faint" &&
    strongest.density >= 0.05 &&
    strongest.density - runnerUp.density >= 0.03
      ? { candidateChoice: CHOICES[strongest.index] }
      : {}),
    status,
    densities: densities.map((d) => Math.round(d * 1000) / 1000),
    confidence: Math.min(
      status === "clear" || status === "blank" ? 99 : 69,
      markConfidence(densities, quadrants, outside) ?? 0,
    ),
    resolved: status === "clear" || status === "blank",
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
  let qr = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
    inversionAttempts: "attemptBoth",
  });
  if (!qr) {
    // Monochrome scanners turn solid printer ink into a fine halftone pattern.
    // Downsampling integrates the dots; median filtering repairs pinholes. Only
    // the QR decoder sees these variants: answer measurements use the untouched
    // raster, and every decoded point is mapped back to its original coordinates.
    for (const [median, factor] of [
      [false, 0.5],
      [true, 0.5],
      [true, 1],
    ] as const) {
      let variant = sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
      });
      if (median) variant = variant.median(3);
      const width = Math.max(1, Math.round(info.width * factor));
      const processed = await variant
        .resize({ width })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const decoded = jsQR(
        new Uint8ClampedArray(processed.data),
        processed.info.width,
        processed.info.height,
        { inversionAttempts: "attemptBoth" },
      );
      if (!decoded) continue;
      const sx = info.width / processed.info.width;
      const sy = info.height / processed.info.height;
      qr = {
        ...decoded,
        location: Object.fromEntries(
          Object.entries(decoded.location).map(([key, point]) => [
            key,
            point ? { x: point.x * sx, y: point.y * sy } : undefined,
          ]),
        ) as QRCode["location"],
      };
      break;
    }
  }
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
  let markers = MARKERS.map((p) => findMarker(raster, predict(p), scale));
  for (const kernel of [3, 5]) {
    if (markers.every(Boolean)) break;
    const cleaned = await sharp(gray, {
      raw: { width: found.width, height: found.height, channels: 1 },
    })
      .median(kernel)
      .grayscale()
      .raw()
      .toBuffer();
    const alignmentRaster = { ...raster, data: cleaned };
    markers = MARKERS.map(
      (p, i) => markers[i] ?? findMarker(alignmentRaster, predict(p), scale),
    );
  }
  const markerCount = markers.filter(Boolean).length;
  if (markerCount < 3 || (markerCount < 4 && (!found.identifier || forcedRotation !== undefined)))
    return fail(
      "All four alignment squares must be clear and visible. Rescan or review manually.",
    );
  const present = MARKERS.map((point, i) => ({ source: point, target: markers[i] })).filter((pair): pair is { source: Point; target: Point } => Boolean(pair.target));
  const map = markerCount === 4
    ? homography(MARKERS, markers as Point[])
    : affineMap(present.map((pair) => pair.source), present.map((pair) => pair.target));
  const qrCorners = found.qr
    ? [
        found.qr.location.topLeftCorner,
        found.qr.location.topRightCorner,
        found.qr.location.bottomRightCorner,
        found.qr.location.bottomLeftCorner,
      ]
    : [];
  const alignment = {
    qrCornerErrors: qrCorners.map((point, i) => Math.hypot(map(qrSource[i]).x - point.x, map(qrSource[i]).y - point.y) / scale),
    scale,
    markers,
    markerCount,
    rows: [] as { x: number; y: number; contrast: number; support: number }[],
  };
  const maximumQrError = Math.max(0, ...alignment.qrCornerErrors);
  // Decoder corner estimates and paper-feed drift can differ by a QR module.
  // Beyond the old 3pt gate, require direct evidence from every printed row.
  // A two-module bound still rejects a displaced QR / wrong page transform.
  const needsGridVerification = markerCount < 4 || maximumQrError > 3;
  const maximumDrift = 2 * QR.size / (QR.modules + 2 * QR.quiet);
  if (
    found.qr &&
    found.identifier &&
    maximumQrError > maximumDrift
  )
    return {
      ...fail("QR and alignment squares disagree. Rescan or review manually."),
      alignment,
      reviewPreview: await normalizeReviewRaster(raster, map),
    };
  const offsets = questions.map((_, i) => refineBubbleRow(raster, map, i));
  alignment.rows = offsets;
  if (needsGridVerification && offsets.some((row) => row.contrast < .30 || row.support < .20))
    return {
      ...fail("Printed answer rows could not confirm page alignment. Rescan or review manually."),
      alignment,
      reviewPreview: await normalizeReviewRaster(raster, map),
    };
  const readings: BubbleReading[] = questions.map((question, i) => {
    const offset = offsets[i];
    const densities: number[] = [];
    const quadrants: number[] = [];
    const outside: number[] = [];
    for (let c = 0; c < 4; c++) {
      const point = bubblePosition(i, c);
      const center = { x: point.x + offset.x, y: point.y + offset.y };
      let dark = 0;
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
            if (v < 190) {
              dark++;
              qDark[q]++;
            }
          } else {
            outerTotal++;
            if (v < 160) outerDark++;
          }
        }
      densities.push(dark / total);
      quadrants.push(Math.min(...qDark.map((n, q) => n / qTotal[q])));
      outside.push(outerDark / outerTotal);
    }
    return {
      position: question.position,
      ...classifyBubble(densities, quadrants, outside),
    };
  });
  return {
    identifier: found.identifier,
    readings,
    problem:
      forcedRotation !== undefined
        ? "Manually identified sheet: confirm every answer before finalization."
        : null,
    normalized: await normalizeReviewRaster(raster, map),
    algorithm: SCAN_ALGORITHM,
    alignment,
  };
}
