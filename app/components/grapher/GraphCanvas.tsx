"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clampViewport, niceStep, type GraphViewport } from "./engine";
import type { PlotRequest, PlotResponse, PlotRowInput } from "./plot.worker";
import styles from "./grapher.module.css";

type Props = {
  rows: PlotRowInput[];
  constants: Record<string, number>;
  viewport: GraphViewport;
  onViewportChange: (viewport: GraphViewport) => void;
  onErrors: (errors: Record<string, string>) => void;
};

type ScreenPoint = { x: number; y: number };

function toMath(point: ScreenPoint, width: number, height: number, viewport: GraphViewport) {
  return {
    x: viewport.xMin + (point.x / width) * (viewport.xMax - viewport.xMin),
    y: viewport.yMax - (point.y / height) * (viewport.yMax - viewport.yMin),
  };
}

function toScreen(point: ScreenPoint, width: number, height: number, viewport: GraphViewport) {
  return {
    x: ((point.x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width,
    y: ((viewport.yMax - point.y) / (viewport.yMax - viewport.yMin)) * height,
  };
}

function format(value: number) {
  if (Math.abs(value) < 1e-10) return "0";
  if (Math.abs(value) >= 10_000 || Math.abs(value) < 0.001) return value.toExponential(2);
  return Number(value.toPrecision(5)).toString();
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, viewport: GraphViewport) {
  context.fillStyle = "#fbfcff";
  context.fillRect(0, 0, width, height);
  const xStep = niceStep(viewport.xMax - viewport.xMin, Math.max(4, Math.round(width / 75)));
  const yStep = niceStep(viewport.yMax - viewport.yMin, Math.max(4, Math.round(height / 62)));
  const xStart = Math.ceil(viewport.xMin / xStep) * xStep;
  const yStart = Math.ceil(viewport.yMin / yStep) * yStep;
  context.lineWidth = 1;
  context.strokeStyle = "#e6eaf0";
  context.beginPath();
  for (let x = xStart; x <= viewport.xMax + xStep / 2; x += xStep) {
    const screen = toScreen({ x, y: 0 }, width, height, viewport);
    context.moveTo(Math.round(screen.x) + 0.5, 0);
    context.lineTo(Math.round(screen.x) + 0.5, height);
  }
  for (let y = yStart; y <= viewport.yMax + yStep / 2; y += yStep) {
    const screen = toScreen({ x: 0, y }, width, height, viewport);
    context.moveTo(0, Math.round(screen.y) + 0.5);
    context.lineTo(width, Math.round(screen.y) + 0.5);
  }
  context.stroke();

  const origin = toScreen({ x: 0, y: 0 }, width, height, viewport);
  context.strokeStyle = "#8b97a8";
  context.lineWidth = 1.25;
  context.beginPath();
  if (origin.x >= 0 && origin.x <= width) { context.moveTo(origin.x, 0); context.lineTo(origin.x, height); }
  if (origin.y >= 0 && origin.y <= height) { context.moveTo(0, origin.y); context.lineTo(width, origin.y); }
  context.stroke();

  context.fillStyle = "#687386";
  context.font = "11px ui-sans-serif, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "top";
  const xLabelY = Math.min(height - 16, Math.max(4, origin.y + 5));
  for (let x = xStart; x <= viewport.xMax + xStep / 2; x += xStep) {
    if (Math.abs(x) < xStep / 100) continue;
    const screen = toScreen({ x, y: 0 }, width, height, viewport);
    if (screen.x > 20 && screen.x < width - 20) context.fillText(format(x), screen.x, xLabelY);
  }
  context.textAlign = "left";
  context.textBaseline = "middle";
  const yLabelX = Math.min(width - 38, Math.max(5, origin.x + 6));
  for (let y = yStart; y <= viewport.yMax + yStep / 2; y += yStep) {
    if (Math.abs(y) < yStep / 100) continue;
    const screen = toScreen({ x: 0, y }, width, height, viewport);
    if (screen.y > 12 && screen.y < height - 12) context.fillText(format(y), yLabelX, screen.y);
  }
}

export default function GraphCanvas({ rows, constants, viewport, onViewportChange, onErrors }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const dragRef = useRef<{ start: ScreenPoint; viewport: GraphViewport } | null>(null);
  const [size, setSize] = useState({ width: 640, height: 480 });
  const [result, setResult] = useState<PlotResponse>({ requestId: 0, paths: [], fills: [], points: [], errors: {} });
  const [cursor, setCursor] = useState<ScreenPoint | null>(null);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: Math.max(280, Math.round(entry.contentRect.width)), height: Math.max(260, Math.round(entry.contentRect.height)) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    const xRange = viewport.xMax - viewport.xMin;
    const yRange = viewport.yMax - viewport.yMin;
    const squareScaleYRange = xRange * (size.height / size.width);
    if (Math.abs(squareScaleYRange - yRange) / Math.max(yRange, 0.0001) < 0.01) return;
    const center = (viewport.yMin + viewport.yMax) / 2;
    onViewportChange({ ...viewport, yMin: center - squareScaleYRange / 2, yMax: center + squareScaleYRange / 2 });
  }, [onViewportChange, size.height, size.width, viewport]);

  useEffect(() => {
    const worker = new Worker(new URL("./plot.worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<PlotResponse>) => {
      if (event.data.requestId !== requestRef.current) return;
      setResult(event.data);
      onErrors(event.data.errors);
    };
    return () => { worker.terminate(); workerRef.current = null; };
  }, [onErrors]);

  useEffect(() => {
    if (!workerRef.current || size.width < 1 || size.height < 1) return;
    requestRef.current += 1;
    const request: PlotRequest = { requestId: requestRef.current, width: size.width, height: size.height, viewport, rows, constants };
    workerRef.current.postMessage(request);
  }, [constants, rows, size, viewport]);

  const nearestPoint = useMemo(() => {
    if (!cursor) return null;
    let nearest: { point: PlotResponse["points"][number]; distance: number; screen: ScreenPoint } | null = null;
    for (const point of result.points) {
      const screen = toScreen(point, size.width, size.height, viewport);
      const distance = Math.hypot(screen.x - cursor.x, screen.y - cursor.y);
      if (distance <= 18 && (!nearest || distance < nearest.distance)) nearest = { point, distance, screen };
    }
    return nearest;
  }, [cursor, result.points, size, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawGrid(context, size.width, size.height, viewport);

    for (const fill of result.fills) {
      context.save();
      context.globalAlpha = 0.12;
      context.fillStyle = fill.color;
      for (let index = 0; index < fill.rectangles.length; index += 4) {
        context.fillRect(fill.rectangles[index]!, fill.rectangles[index + 1]!, fill.rectangles[index + 2]!, fill.rectangles[index + 3]!);
      }
      context.restore();
    }
    for (const path of result.paths) {
      context.beginPath();
      for (let index = 0; index < path.points.length; index += 2) {
        const x = path.points[index]!;
        const y = path.points[index + 1]!;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.strokeStyle = path.color;
      context.lineWidth = 2.4;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();
    }
    for (const point of result.points) {
      const screen = toScreen(point, size.width, size.height, viewport);
      if (screen.x < -8 || screen.x > size.width + 8 || screen.y < -8 || screen.y > size.height + 8) continue;
      context.beginPath();
      context.arc(screen.x, screen.y, point.kind === "point" ? 5.5 : 4, 0, Math.PI * 2);
      context.fillStyle = point.color;
      context.fill();
      context.strokeStyle = "white";
      context.lineWidth = 1.8;
      context.stroke();
    }
    if (nearestPoint) {
      context.beginPath();
      context.arc(nearestPoint.screen.x, nearestPoint.screen.y, 8, 0, Math.PI * 2);
      context.strokeStyle = nearestPoint.point.color;
      context.lineWidth = 2;
      context.stroke();
    }
  }, [nearestPoint, result, size, viewport]);

  const zoom = (factor: number, center = { x: size.width / 2, y: size.height / 2 }) => {
    const math = toMath(center, size.width, size.height, viewport);
    onViewportChange(clampViewport({
      xMin: math.x + (viewport.xMin - math.x) * factor,
      xMax: math.x + (viewport.xMax - math.x) * factor,
      yMin: math.y + (viewport.yMin - math.y) * factor,
      yMax: math.y + (viewport.yMax - math.y) * factor,
    }));
  };

  const cursorMath = cursor ? toMath(cursor, size.width, size.height, viewport) : null;
  const tooltip = nearestPoint ? nearestPoint.point.label ?? `(${format(nearestPoint.point.x)}, ${format(nearestPoint.point.y)})` : null;

  return <div className={styles.canvasShell} ref={shellRef}>
    <canvas
      aria-label="Interactive coordinate plane. Drag to pan and use the controls to zoom."
      className={styles.canvas}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { start: { x: event.clientX, y: event.clientY }, viewport };
      }}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setCursor({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        const drag = dragRef.current;
        if (!drag) return;
        const dx = event.clientX - drag.start.x;
        const dy = event.clientY - drag.start.y;
        const xShift = -(dx / size.width) * (drag.viewport.xMax - drag.viewport.xMin);
        const yShift = (dy / size.height) * (drag.viewport.yMax - drag.viewport.yMin);
        onViewportChange({ xMin: drag.viewport.xMin + xShift, xMax: drag.viewport.xMax + xShift, yMin: drag.viewport.yMin + yShift, yMax: drag.viewport.yMax + yShift });
      }}
      onPointerLeave={() => { if (!dragRef.current) setCursor(null); }}
      onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); dragRef.current = null; }}
      onWheel={(event) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        zoom(event.deltaY > 0 ? 1.14 : 0.88, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      }}
      ref={canvasRef}
      role="img"
    />
    <div aria-label="Graph view controls" className={styles.graphControls}>
      <button aria-label="Zoom in" onClick={() => zoom(0.75)} type="button">+</button>
      <button aria-label="Zoom out" onClick={() => zoom(1.3)} type="button">−</button>
      <button aria-label="Reset graph view" className={styles.homeButton} onClick={() => onViewportChange({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 })} type="button">⌂</button>
    </div>
    {cursorMath && <output className={styles.coordinates}>{tooltip ?? `x ${format(cursorMath.x)}   y ${format(cursorMath.y)}`}</output>}
    <div className={styles.canvasHint}>Drag to move · Scroll to zoom</div>
  </div>;
}
