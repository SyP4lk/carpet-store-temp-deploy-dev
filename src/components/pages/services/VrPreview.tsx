"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Locale } from "@/localization/config";
import type { RugProduct } from "@/types/product";
import { drawImageToQuad, drawShadow, pointInQuad, type Point, type Quad } from "./vr/warp";

type LayerId = "A" | "B";

type BrushMode = "draw" | "erase";

type LayerState = {
  id: LayerId;
  product: RugProduct | null;
  img: HTMLImageElement | null;
  article: string;
  size: string;
  scalePct: number;
  rotateDeg: number;
  shadowPct: number;
  quad: Quad | null;
  shadowOn: boolean;
  maskEditing: boolean;
  maskBrush: number;
  maskMode: BrushMode;
};

type DragMode = "none" | "corner" | "move" | "rotate" | "mask";

const SCALE_MIN = 40;
const SCALE_MAX = 180;
const ROTATE_MIN = -90;
const ROTATE_MAX = 90;

function dist(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function centerOfQuad(q: Quad): Point {
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
}

function rotateHandlePosition(quad: Quad, offset: number): Point {
  const c = centerOfQuad(quad);
  const topMid = midpoint(quad[0], quad[1]);
  const vx = topMid.x - c.x;
  const vy = topMid.y - c.y;
  const len = Math.hypot(vx, vy);
  if (!Number.isFinite(len) || len < 1e-3) {
    return { x: c.x, y: c.y - offset };
  }
  const ux = vx / len;
  const uy = vy / len;
  return { x: c.x + ux * offset, y: c.y + uy * offset };
}

function rotatePointAround(p: Point, c: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = p.x - c.x;
  const y = p.y - c.y;
  return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
}

function scalePointAround(p: Point, c: Point, factor: number): Point {
  return { x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor };
}

function parseSizeArea(sizeLabel: string): number | null {
  // supports: 80 x 150, 80x150, 80×150, 80 х 150
  const s = (sizeLabel ?? "").replace(/cm/gi, "").trim();
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*[x×х]\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  const a = Number.parseFloat(m[1].replace(",", "."));
  const b = Number.parseFloat(m[2].replace(",", "."));
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return a * b;
}

async function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

async function downscaleToBlobUrl(file: File, maxDim = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));

  const c = document.createElement("canvas");
  c.width = nw;
  c.height = nh;

  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, nw, nh);

  const blob: Blob = await new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92);
  });

  return URL.createObjectURL(blob);
}

function initRectQuad(canvasW: number, canvasH: number, rugImg: HTMLImageElement): Quad {
  const rw = canvasW * 0.42;
  const aspect = (rugImg.naturalHeight || rugImg.height) / (rugImg.naturalWidth || rugImg.width);
  const rh = rw * aspect;

  const cx = canvasW * 0.5;
  const cy = canvasH * 0.68;

  const tl = { x: cx - rw / 2, y: cy - rh / 2 };
  const tr = { x: cx + rw / 2, y: cy - rh / 2 };
  const br = { x: cx + rw / 2, y: cy + rh / 2 };
  const bl = { x: cx - rw / 2, y: cy + rh / 2 };
  return [tl, tr, br, bl];
}

export default function VrPreview({ locale }: { locale: Locale }) {
  const isRu = locale === "ru";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const setRoomUrlSafe = (next: string | null) => {
     setRoomUrl((prev) => {
       if (prev && prev.startsWith("blob:")) {
         try { URL.revokeObjectURL(prev); } catch {}
       }
       return next;
     });
   };
  const [roomImg, setRoomImg] = useState<HTMLImageElement | null>(null);

  const [active, setActive] = useState<LayerId>("A");
  const [compareMode, setCompareMode] = useState(false);
  const [compareSplit, setCompareSplit] = useState(50);

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<"png" | "jpg">("png");

  const [layerA, setLayerA] = useState<LayerState>({
    id: "A",
    product: null,
    img: null,
    article: "",
    size: "",
    scalePct: 100,
    rotateDeg: 0,
    shadowPct: 25,
    quad: null,
    shadowOn: true,
    maskEditing: false,
    maskBrush: 24,
    maskMode: "draw",
  });

  const [layerB, setLayerB] = useState<LayerState>({
    id: "B",
    product: null,
    img: null,
    article: "",
    size: "",
    scalePct: 100,
    rotateDeg: 0,
    shadowPct: 25,
    quad: null,
    shadowOn: true,
    maskEditing: false,
    maskBrush: 24,
    maskMode: "draw",
  });

  const getLayer = (id: LayerId) => (id === "A" ? layerA : layerB);
  const setLayer = (id: LayerId, next: LayerState) => (id === "A" ? setLayerA(next) : setLayerB(next));
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  const maskCanvasesRef = useRef<Record<LayerId, HTMLCanvasElement | null>>({ A: null, B: null });
  const maskHasContentRef = useRef<Record<LayerId, boolean>>({ A: false, B: false });
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const gestureRef = useRef<{
    active: boolean;
    pointerIds: [number, number] | null;
    startDist: number;
    startAngle: number;
    startScale: number;
    startRotate: number;
  }>({
    active: false,
    pointerIds: null,
    startDist: 1,
    startAngle: 0,
    startScale: 100,
    startRotate: 0,
  });

  // Resize canvas to container
  useEffect(() => {
    const el = hostRef.current;
    const c = canvasRef.current;
    if (!el || !c) return;

    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(360, Math.floor(rect.height));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      draw();
    });

    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomImg, layerA, layerB, compareMode, compareSplit, active, isCoarsePointer]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarsePointer(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isCoarsePointer) return;
    setLayerA((prev) => (prev.maskBrush === 24 ? { ...prev, maskBrush: 40 } : prev));
    setLayerB((prev) => (prev.maskBrush === 24 ? { ...prev, maskBrush: 40 } : prev));
  }, [isCoarsePointer]);

  // Load room image
  useEffect(() => {
    if (!roomUrl) return;
    let alive = true;
    loadImg(roomUrl)
      .then((img) => {
        if (!alive) return;
        setRoomImg(img);
      })
      .catch(() => {
        if (!alive) return;
        setRoomImg(null);
      });
    return () => {
      alive = false;
      if (roomUrl && roomUrl.startsWith("blob:")) {
         try { URL.revokeObjectURL(roomUrl); } catch {}
       }
    };
  }, [roomUrl]);

  const scheduleDraw = () => {
    if (drawRafRef.current !== null) return;
    drawRafRef.current = window.requestAnimationFrame(() => {
      drawRafRef.current = null;
      draw();
    });
  };

  const ensureScratchCanvas = (w: number, h: number) => {
    if (!scratchCanvasRef.current) {
      scratchCanvasRef.current = document.createElement("canvas");
    }
    const c = scratchCanvasRef.current;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c;
  };

  const getMaskCanvas = (id: LayerId, w: number, h: number) => {
    const current = maskCanvasesRef.current[id];
    if (!current) {
      const created = document.createElement("canvas");
      created.width = w;
      created.height = h;
      maskCanvasesRef.current[id] = created;
      return created;
    }

    if (current.width !== w || current.height !== h) {
      const next = document.createElement("canvas");
      next.width = w;
      next.height = h;
      const nctx = next.getContext("2d");
      if (nctx) nctx.drawImage(current, 0, 0, w, h);
      maskCanvasesRef.current[id] = next;
      return next;
    }

    return current;
  };

  const resetMasks = () => {
    maskCanvasesRef.current = { A: null, B: null };
    maskHasContentRef.current = { A: false, B: false };
    scheduleDraw();
  };

  const clearMask = (id: LayerId) => {
    const c = maskCanvasesRef.current[id];
    if (c) {
      const ctx = c.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, c.width, c.height);
    }
    maskHasContentRef.current[id] = false;
    scheduleDraw();
  };

  const drawMaskStroke = (id: LayerId, from: Point, to: Point, size: number, mode: BrushMode) => {
    const main = canvasRef.current;
    if (!main) return;
    const mask = getMaskCanvas(id, main.width, main.height);
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "black";
    ctx.fillStyle = "black";
    ctx.lineWidth = size;
    ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    if (dist(from, to) < 0.5) {
      ctx.beginPath();
      ctx.arc(to.x, to.y, Math.max(1, size / 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    maskHasContentRef.current[id] = true;
    scheduleDraw();
  };

  const drawRoom = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (roomImg) {
      const iw = roomImg.naturalWidth || roomImg.width;
      const ih = roomImg.naturalHeight || roomImg.height;
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.drawImage(roomImg, dx, dy, dw, dh);
      return;
    }

    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(0, 0, w, h);
  };

  // Draw
  const renderScene = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    options: { includeGuides?: boolean; includeSplitLine?: boolean } = {}
  ) => {
    const { includeGuides = true, includeSplitLine = true } = options;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawRoom(ctx, w, h);

    const drawLayer = (layer: LayerState, clip?: { x: number; y: number; w: number; h: number }) => {
      if (!layer.img || !layer.quad) return;
      const maskOn = maskHasContentRef.current[layer.id];

      if (clip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(clip.x, clip.y, clip.w, clip.h);
        ctx.clip();
      }

      if (!maskOn) {
        if (layer.shadowOn) drawShadow(ctx, layer.quad, layer.shadowPct);
        drawImageToQuad(ctx, layer.img, layer.quad, 18);
      } else {
        const scratch = ensureScratchCanvas(w, h);
        const sctx = scratch.getContext("2d");
        if (!sctx) return;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, w, h);
        if (layer.shadowOn) drawShadow(sctx, layer.quad, layer.shadowPct);
        drawImageToQuad(sctx, layer.img, layer.quad, 18);
        sctx.globalCompositeOperation = "destination-out";
        const mask = getMaskCanvas(layer.id, w, h);
        sctx.drawImage(mask, 0, 0, w, h);
        sctx.globalCompositeOperation = "source-over";
        ctx.drawImage(scratch, 0, 0, w, h);
      }

      if (clip) ctx.restore();
    };

    const la = layerA;
    const lb = layerB;

    if (compareMode && la.img && la.quad && lb.img && lb.quad) {
      drawLayer(la);
      const splitX = (compareSplit / 100) * w;
      drawLayer(lb, { x: splitX, y: 0, w: w - splitX, h });

      if (includeSplitLine) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(splitX, 0);
        ctx.lineTo(splitX, h);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      drawLayer(la);
      drawLayer(lb);
    }

    if (includeGuides) {
      const act = active === "A" ? la : lb;
      if (act.quad) {
        const cornerRadius = isCoarsePointer ? 12 : 7;
        const rotateRadius = isCoarsePointer ? 14 : 9;
        const rotateOffset = isCoarsePointer ? 64 : 46;
        const center = centerOfQuad(act.quad);
        const rotatePos = rotateHandlePosition(act.quad, rotateOffset);

        ctx.save();
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = isCoarsePointer ? 2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(rotatePos.x, rotatePos.y);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "#111827";
        for (const p of act.quad) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, cornerRadius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rotatePos.x, rotatePos.y, rotateRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  const draw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    renderScene(ctx, c.width, c.height, { includeGuides: true, includeSplitLine: true });
  };

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomImg, layerA, layerB, compareMode, compareSplit, active]);

  // Interaction
  const dragRef = useRef<{
    mode: DragMode;
    cornerIndex: number;
    last: Point;
    pointerId: number | null;
    startAngle: number;
    startRotate: number;
    center: Point | null;
  }>({
    mode: "none",
    cornerIndex: -1,
    last: { x: 0, y: 0 },
    pointerId: null,
    startAngle: 0,
    startRotate: 0,
    center: null,
  });

  const getPointer = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const applyScaleRotate = (id: LayerId, nextScalePct: number, nextRotateDeg: number) => {
    const layer = getLayer(id);
    const safeScale = clamp(nextScalePct, SCALE_MIN, SCALE_MAX);
    const safeRotate = clamp(nextRotateDeg, ROTATE_MIN, ROTATE_MAX);
    if (!layer.quad) return setLayer(id, { ...layer, scalePct: safeScale, rotateDeg: safeRotate });

    let nextQuad = layer.quad.map((p) => ({ ...p })) as Quad;
    const center = centerOfQuad(nextQuad);

    if (safeScale !== layer.scalePct) {
      const factor = safeScale / (layer.scalePct || 1);
      nextQuad = nextQuad.map((p) => scalePointAround(p, center, factor)) as Quad;
    }

    if (safeRotate !== layer.rotateDeg) {
      const delta = safeRotate - (layer.rotateDeg || 0);
      nextQuad = nextQuad.map((p) => rotatePointAround(p, center, delta)) as Quad;
    }

    setLayer(id, { ...layer, scalePct: safeScale, rotateDeg: safeRotate, quad: nextQuad });
  };

  const beginGesture = (layer: LayerState) => {
    const ids = Array.from(pointersRef.current.keys());
    if (ids.length < 2) return;
    const p1 = pointersRef.current.get(ids[0]);
    const p2 = pointersRef.current.get(ids[1]);
    if (!p1 || !p2) return;
    gestureRef.current = {
      active: true,
      pointerIds: [ids[0], ids[1]],
      startDist: Math.max(1, dist(p1, p2)),
      startAngle: Math.atan2(p2.y - p1.y, p2.x - p1.x),
      startScale: layer.scalePct,
      startRotate: layer.rotateDeg,
    };
  };

  const endGesture = () => {
    gestureRef.current.active = false;
    gestureRef.current.pointerIds = null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") e.preventDefault();
    const p = getPointer(e);
    pointersRef.current.set(e.pointerId, p);
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);

    const act = getLayer(active);
    if (!act.quad) return;

    const isTouchInput = isCoarsePointer || e.pointerType === "touch";

    if (pointersRef.current.size >= 2) {
      if (!act.maskEditing) beginGesture(act);
      dragRef.current.mode = "none";
      dragRef.current.pointerId = null;
      return;
    }

    if (act.maskEditing) {
      dragRef.current = {
        mode: "mask",
        cornerIndex: -1,
        last: p,
        pointerId: e.pointerId,
        startAngle: 0,
        startRotate: 0,
        center: null,
      };
      drawMaskStroke(active, p, p, act.maskBrush, act.maskMode);
      return;
    }

    const cornerHit = isTouchInput ? 32 : 14;
    const rotateHit = isTouchInput ? 36 : 16;
    const rotateOffset = isTouchInput ? 64 : 46;
    const rotatePos = rotateHandlePosition(act.quad, rotateOffset);

    if (dist(p, rotatePos) <= rotateHit) {
      const center = centerOfQuad(act.quad);
      dragRef.current = {
        mode: "rotate",
        cornerIndex: -1,
        last: p,
        pointerId: e.pointerId,
        startAngle: Math.atan2(p.y - center.y, p.x - center.x),
        startRotate: act.rotateDeg,
        center,
      };
      return;
    }

    for (let i = 0; i < 4; i++) {
      if (dist(p, act.quad[i]) <= cornerHit) {
        dragRef.current = {
          mode: "corner",
          cornerIndex: i,
          last: p,
          pointerId: e.pointerId,
          startAngle: 0,
          startRotate: 0,
          center: null,
        };
        return;
      }
    }

    if (pointInQuad(p, act.quad)) {
      dragRef.current = {
        mode: "move",
        cornerIndex: -1,
        last: p,
        pointerId: e.pointerId,
        startAngle: 0,
        startRotate: 0,
        center: null,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hasPointer = pointersRef.current.has(e.pointerId);
    if (!hasPointer) return;
    if (e.pointerType === "touch") e.preventDefault();

    const p = getPointer(e);
    pointersRef.current.set(e.pointerId, p);

    const act = getLayer(active);
    if (!act.quad) return;

    if (act.maskEditing) {
      if (dragRef.current.mode === "mask" && dragRef.current.pointerId === e.pointerId) {
        drawMaskStroke(active, dragRef.current.last, p, act.maskBrush, act.maskMode);
        dragRef.current.last = p;
      }
      return;
    }

    if (pointersRef.current.size >= 2) {
      if (!gestureRef.current.active) beginGesture(act);
      const g = gestureRef.current;
      if (g.active && g.pointerIds) {
        const [id1, id2] = g.pointerIds;
        const p1 = pointersRef.current.get(id1);
        const p2 = pointersRef.current.get(id2);
        if (!p1 || !p2) {
          endGesture();
          return;
        }
        const nextDist = Math.max(1, dist(p1, p2));
        const nextAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const nextScale = clamp(g.startScale * (nextDist / g.startDist), SCALE_MIN, SCALE_MAX);
        const nextRotate = clamp(g.startRotate + ((nextAngle - g.startAngle) * 180) / Math.PI, ROTATE_MIN, ROTATE_MAX);
        applyScaleRotate(active, nextScale, nextRotate);
      }
      return;
    }

    if (gestureRef.current.active) endGesture();

    const d = dragRef.current;
    if (d.mode === "none" || d.pointerId !== e.pointerId) return;

    if (d.mode === "rotate") {
      const center = d.center ?? centerOfQuad(act.quad);
      const angle = Math.atan2(p.y - center.y, p.x - center.x);
      const delta = ((angle - d.startAngle) * 180) / Math.PI;
      const nextDeg = clamp(d.startRotate + delta, ROTATE_MIN, ROTATE_MAX);
      applyRotate(active, nextDeg);
      return;
    }

    const dx = p.x - d.last.x;
    const dy = p.y - d.last.y;
    d.last = p;

    const next: LayerState = { ...act, quad: [...act.quad.map((pt) => ({ ...pt }))] as Quad };

    if (d.mode === "corner") {
      next.quad![d.cornerIndex] = { x: next.quad![d.cornerIndex].x + dx, y: next.quad![d.cornerIndex].y + dy };
    } else if (d.mode === "move") {
      next.quad = next.quad!.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) as Quad;
    }

    setLayer(active, next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2 && gestureRef.current.active) endGesture();
    if (dragRef.current.pointerId === e.pointerId) {
      dragRef.current.mode = "none";
      dragRef.current.cornerIndex = -1;
      dragRef.current.pointerId = null;
    }
  };

  const applyScale = (id: LayerId, nextPct: number) => {
    const layer = getLayer(id);
    const clamped = clamp(nextPct, SCALE_MIN, SCALE_MAX);
    if (!layer.quad) return setLayer(id, { ...layer, scalePct: clamped });

    const factor = clamped / (layer.scalePct || 1);
    const c = centerOfQuad(layer.quad);
    const nextQuad = layer.quad.map((p) => scalePointAround(p, c, factor)) as Quad;
    setLayer(id, { ...layer, scalePct: clamped, quad: nextQuad });
  };

  const applyRotate = (id: LayerId, nextDeg: number) => {
    const layer = getLayer(id);
    const clamped = clamp(nextDeg, ROTATE_MIN, ROTATE_MAX);
    if (!layer.quad) return setLayer(id, { ...layer, rotateDeg: clamped });

    const delta = clamped - (layer.rotateDeg || 0);
    const c = centerOfQuad(layer.quad);
    const nextQuad = layer.quad.map((p) => rotatePointAround(p, c, delta)) as Quad;
    setLayer(id, { ...layer, rotateDeg: clamped, quad: nextQuad });
  };

  const applyShadow = (id: LayerId, nextPct: number) => {
    const layer = getLayer(id);
    setLayer(id, { ...layer, shadowPct: nextPct });
  };

  const applyShadowToggle = (id: LayerId, on: boolean) => {
     const layer = getLayer(id);
     setLayer(id, { ...layer, shadowOn: on });
   };

  const applySize = (id: LayerId, nextSize: string) => {
    const layer = getLayer(id);
    const oldArea = layer.size ? parseSizeArea(layer.size) : null;
    const newArea = nextSize ? parseSizeArea(nextSize) : null;

    if (layer.quad && oldArea && newArea && oldArea > 0 && newArea > 0) {
      const factor = Math.sqrt(newArea / oldArea);
      const c = centerOfQuad(layer.quad);
      const nextQuad = layer.quad.map((p) => scalePointAround(p, c, factor)) as Quad;
      setLayer(id, { ...layer, size: nextSize, quad: nextQuad });
    } else {
      setLayer(id, { ...layer, size: nextSize });
    }
  };

  const findProduct = async (id: LayerId) => {
    setError(null);
    const layer = getLayer(id);
    const code = layer.article.trim();
    if (!code) {
      setError(isRu ? "Введите артикул" : "Enter article");
      return;
    }

    setLoading(isRu ? "Поиск..." : "Searching...");
    try {
      const res = await fetch(`/api/vr/product?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      if (!res.ok) {
        setLoading(null);
        setError(res.status === 404 ? (isRu ? "Не найдено" : "Not found") : (isRu ? "Ошибка поиска" : "Search error"));
        return;
      }

      const data = await res.json();
      const product: RugProduct = data.product;

      const imageUrl = product.images?.[0];
      if (!imageUrl) {
        setLoading(null);
        setError(isRu ? "У товара нет картинки" : "No image found");
        return;
      }

      const img = await loadImg(imageUrl);

      const c = canvasRef.current;
      if (!c) {
        setLoading(null);
        setError(isRu ? "Canvas не готов" : "Canvas not ready");
        return;
      }

      const sizes = (product.sizes ?? []).filter((s) => !/özel\s*ölçü|ozel\s*olcu/i.test(s));
      const size = (product.defaultSize && sizes.includes(product.defaultSize)) ? product.defaultSize : (sizes[0] ?? "");

      const quad = initRectQuad(c.width, c.height, img);

      const next: LayerState = {
        ...layer,
        product,
        img,
        size,
        quad,
        scalePct: 100,
        rotateDeg: 0,
        shadowPct: 25,
        shadowOn: true,
      };

      setLayer(id, next);
      setLoading(null);
    } catch {
      setLoading(null);
      setError(isRu ? "Ошибка загрузки" : "Load error");
    }
  };
  const download = async () => {
     const c = canvasRef.current;
     if (!c) return;
 
     setError(null);
 
     const mime = downloadFormat === "jpg" ? "image/jpeg" : "image/png";
     const ext = downloadFormat === "jpg" ? "jpg" : "png";
 
     try {
       const out = document.createElement("canvas");
       out.width = c.width;
       out.height = c.height;
       const octx = out.getContext("2d");
       if (!octx) throw new Error("Canvas not supported");
       renderScene(octx, out.width, out.height, { includeGuides: false, includeSplitLine: false });

       const blob: Blob = await new Promise((resolve, reject) => {
         out.toBlob(
           (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
           mime,
           downloadFormat === "jpg" ? 0.92 : undefined
         );
       });
 
       const url = URL.createObjectURL(blob);
       const a = document.createElement("a");
       a.href = url;
       a.download = `koenigcarpet-vr.${ext}`;
       a.click();
       URL.revokeObjectURL(url);
     } catch {
       setError(
         isRu
           ? "Не удалось скачать изображение (проверьте CORS и консоль)."
           : "Download failed (check CORS and console)."
       );
     }
   };

  const onRoomFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    resetMasks();
    try {
      const url = await downscaleToBlobUrl(file, 1600);
      setRoomUrlSafe(url);
    } catch {
      // fallback
      const url = URL.createObjectURL(file);
      setRoomUrlSafe(url);
    }
  };

  const activeLayer = getLayer(active);
  const canDownload = !!roomImg && (!!layerA.img || !!layerB.img);

  const sizeOptions = (p: RugProduct | null) =>
    (p?.sizes ?? []).filter((s) => !/özel\s*ölçü|ozel\s*olcu/i.test(s));

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-gray-200 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {isRu ? "VR примерка" : "VR try-on"}
          </h3>
          <p className="text-sm text-gray-600">
            {isRu
              ? "Загрузите фото, найдите ковер по артикулу, настройте перспективу и скачайте результат."
              : "Upload a photo, find a rug by article, adjust perspective and download the result."}
          </p>
          {loading ? <p className="text-sm text-gray-600 mt-1">{loading}</p> : null}
          {error ? <p className="text-sm text-red-600 mt-1">{error}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCompareMode((v) => !v)}
            className="h-10 px-4 rounded-lg border border-gray-300 text-gray-800 text-sm font-semibold hover:bg-gray-50 whitespace-nowrap"
          >
            {compareMode ? (isRu ? "Обычный режим" : "Normal") : (isRu ? "Сравнение" : "Compare")}
          </button>
           <select
             id="vr-download-format"
             className="h-10 px-2 rounded-lg border border-gray-300 bg-white text-sm"
             value={downloadFormat}
             onChange={(e) => setDownloadFormat(e.target.value as "png" | "jpg")}
           >
             <option value="png">PNG</option>
             <option value="jpg">JPG</option>
           </select>
          <button
            type="button"
            onClick={download}
            disabled={!canDownload}
            className={`h-10 px-3 rounded-lg font-semibold ${canDownload ? "bg-black text-white hover:bg-black/90" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}
          >
            {isRu ? "Скачать" : "Download"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
        <div className="lg:col-span-3 p-5">
          <div ref={hostRef} className="min-h-[420px] md:min-h-[560px] rounded-xl border border-gray-200 bg-gray-50 overflow-hidden relative">
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
            />
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <label className="inline-flex items-center justify-center h-11 px-4 rounded-lg bg-black text-white font-semibold cursor-pointer hover:bg-black/90">
              {isRu ? "Загрузить фото" : "Upload photo"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onRoomFile(e.target.files?.[0] ?? null)} />
            </label>

            <button
              type="button"
              onClick={() => setActive("A")}
              className={`h-11 px-4 rounded-lg border font-semibold ${active === "A" ? "border-black text-black" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
            >
              {isRu ? "Ковер A" : "Rug A"}
            </button>

            <button
              type="button"
              onClick={() => setActive("B")}
              className={`h-11 px-4 rounded-lg border font-semibold ${active === "B" ? "border-black text-black" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
            >
              {isRu ? "Ковер B" : "Rug B"}
            </button>
          </div>

          {compareMode ? (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-600">
                <span>{isRu ? "Разделитель сравнения" : "Compare split"}</span>
                <span>{compareSplit}%</span>
              </div>
              <input type="range" min={5} max={95} value={compareSplit} onChange={(e) => setCompareSplit(Number(e.target.value))} className="w-full" />
            </div>
          ) : null}
        </div>

        <div className="lg:col-span-2 p-5 border-t lg:border-t-0 lg:border-l border-gray-200 bg-white">
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
              <p className="text-sm font-semibold text-gray-900">
                {active === "A" ? (isRu ? "Ковер A" : "Rug A") : (isRu ? "Ковер B" : "Rug B")}
              </p>

              <div className="mt-3">
                <label className="text-xs font-semibold uppercase text-gray-600">
                  {isRu ? "Артикул" : "Article"}
                </label>

                <div className="mt-1 flex flex-col gap-2">
                  <input
                    className="h-10 px-4 rounded-lg bg-black text-white font-semibold hover:bg-black/90"
                    value={activeLayer.article}
                    onChange={(e) => setLayer(active, { ...activeLayer, article: e.target.value })}
                    placeholder={isRu ? "Например: 2025-C-4395" : "e.g. 2025-C-4395"}
                  />
                  <button
                    type="button"
                    onClick={() => findProduct(active)}
                    className="h-10 px-4 rounded-lg bg-black text-white font-semibold hover:bg-black/90"
                  >
                    {isRu ? "Найти" : "Find"}
                  </button>
                </div>

                {activeLayer.product ? (
                  <p className="text-xs text-gray-600 mt-2">
                    {isRu ? "Найдено:" : "Found:"}{" "}
                    <span className="font-semibold">
                      {isRu ? activeLayer.product.product_name.ru : activeLayer.product.product_name.en}
                    </span>
                  </p>
                ) : null}
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold uppercase text-gray-600">
                  {isRu ? "Размер" : "Size"}
                </label>

                <select
                  id="vr-size-select"
                  className="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300 bg-white"
                  value={activeLayer.size}
                  onChange={(e) => applySize(active, e.target.value)}
                  disabled={!activeLayer.product}
                >
                  <option value="">{isRu ? "Выберите размер" : "Select size"}</option>
                  {sizeOptions(activeLayer.product).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              
              
              <div className="mt-4 space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>{isRu ? "\u041c\u0430\u0441\u0448\u0442\u0430\u0431" : "Scale"}</span>
                    <span>{activeLayer.scalePct}%</span>
                  </div>
                  <input
                    type="range"
                    min={SCALE_MIN}
                    max={SCALE_MAX}
                    value={activeLayer.scalePct}
                    onChange={(e) => applyScale(active, Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>{isRu ? "\u041f\u043e\u0432\u043e\u0440\u043e\u0442" : "Rotate"}</span>
                    <span>{activeLayer.rotateDeg}{"\u00b0"}</span>
                  </div>
                  <input
                    type="range"
                    min={ROTATE_MIN}
                    max={ROTATE_MAX}
                    value={activeLayer.rotateDeg}
                    onChange={(e) => applyRotate(active, Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => applyRotate(active, activeLayer.rotateDeg - 5)}
                      className="h-9 flex-1 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                      aria-label={isRu ? "\u041f\u043e\u0432\u043e\u0440\u043e\u0442 \u0432\u043b\u0435\u0432\u043e" : "Rotate left"}
                    >
                      CCW
                    </button>
                    <button
                      type="button"
                      onClick={() => applyRotate(active, activeLayer.rotateDeg + 5)}
                      className="h-9 flex-1 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                      aria-label={isRu ? "\u041f\u043e\u0432\u043e\u0440\u043e\u0442 \u0432\u043f\u0440\u0430\u0432\u043e" : "Rotate right"}
                    >
                      CW
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span>{isRu ? "\u0422\u0435\u043d\u044c" : "Shadow"}</span>

                    <label className="inline-flex items-center gap-2 select-none">
                      <input
                        type="checkbox"
                        checked={activeLayer.shadowOn}
                        onChange={(e) => applyShadowToggle(active, e.target.checked)}
                      />
                      <span>{isRu ? "\u0412\u043a\u043b" : "On"}</span>
                    </label>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={activeLayer.shadowPct}
                    onChange={(e) => applyShadow(active, Number(e.target.value))}
                    disabled={!activeLayer.shadowOn}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span>{isRu ? "\u041c\u0430\u0441\u043a\u0430" : "Mask"}</span>
                    <label className="inline-flex items-center gap-2 select-none">
                      <input
                        type="checkbox"
                        checked={activeLayer.maskEditing}
                        onChange={(e) => setLayer(active, { ...activeLayer, maskEditing: e.target.checked })}
                      />
                      <span>{isRu ? "\u0412\u043a\u043b" : "On"}</span>
                    </label>
                  </div>

                  <div className={`mt-2 space-y-2 ${activeLayer.maskEditing ? "" : "opacity-50 pointer-events-none"}`}>
                    <div>
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>{isRu ? "\u0420\u0430\u0437\u043c\u0435\u0440 \u043a\u0438\u0441\u0442\u0438" : "Brush size"}</span>
                        <span>{activeLayer.maskBrush}px</span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={80}
                        value={activeLayer.maskBrush}
                        onChange={(e) => setLayer(active, { ...activeLayer, maskBrush: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setLayer(active, { ...activeLayer, maskMode: "draw" })}
                        className={`h-9 flex-1 rounded-lg border text-xs font-semibold ${activeLayer.maskMode === "draw" ? "border-black text-black" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
                      >
                        {isRu ? "\u0420\u0438\u0441\u043e\u0432\u0430\u0442\u044c" : "Draw"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLayer(active, { ...activeLayer, maskMode: "erase" })}
                        className={`h-9 flex-1 rounded-lg border text-xs font-semibold ${activeLayer.maskMode === "erase" ? "border-black text-black" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
                      >
                        {isRu ? "\u0421\u0442\u0435\u0440\u0435\u0442\u044c" : "Erase"}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => clearMask(active)}
                      className="h-9 w-full rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                    >
                      {isRu ? "\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u043c\u0430\u0441\u043a\u0443" : "Clear mask"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 text-xs text-gray-500">
                {isRu
                  ? "Перспектива: перетаскивайте точки по углам ковра. Перемещение: тяните внутри ковра."
                  : "Perspective: drag corner points. Move: drag inside the rug."}
              </div>
            </div>

            <div className="text-xs text-gray-500">
              {isRu
                ? "Если ковер не рисуется, откройте DevTools - Network и проверьте запрос /api/vr/product."
                : "If the rug is not drawn, check DevTools - Network for /api/vr/product."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
