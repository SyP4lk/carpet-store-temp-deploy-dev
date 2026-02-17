"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  tiltX: number;
  shadowPct: number;
  quad: Quad | null;
  shadowOn: boolean;
  maskEditing: boolean;
  maskBrush: number;
  maskMode: BrushMode;
  maskVisible: boolean;
};

type DragMode = "none" | "corner" | "move" | "rotate" | "mask" | "tilt";

const SCALE_MIN = 40;
const SCALE_MAX = 180;
const ROTATE_MIN = -90;
const ROTATE_MAX = 90;
const TILT_MIN = -35;
const TILT_MAX = 35;
const TILT_FOCUS_MIN = 600;
const TILT_FOCUS_MAX = 1200;
const VR_VIDEO_TUTORIAL_SEEN_KEY = "carpet_vr_video_tutorial_seen_v1";

function createInitialLayer(id: LayerId): LayerState {
  return {
    id,
    product: null,
    img: null,
    article: "",
    size: "",
    scalePct: 100,
    rotateDeg: 0,
    tiltX: 0,
    shadowPct: 25,
    quad: null,
    shadowOn: true,
    maskEditing: false,
    maskBrush: 24,
    maskMode: "draw",
    maskVisible: true,
  };
}

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

function rotateHandlePosition(quad: Quad, offset: number, center?: Point): Point {
  const c = center ?? centerOfQuad(quad);
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

function quadFrame(quad: Quad) {
  const center = centerOfQuad(quad);
  const topMid = midpoint(quad[0], quad[1]);
  const bottomMid = midpoint(quad[3], quad[2]);
  const leftMid = midpoint(quad[0], quad[3]);
  const rightMid = midpoint(quad[1], quad[2]);

  const ex = { x: rightMid.x - leftMid.x, y: rightMid.y - leftMid.y };
  const ey = { x: bottomMid.x - topMid.x, y: bottomMid.y - topMid.y };
  const width = Math.hypot(ex.x, ex.y);
  const height = Math.hypot(ey.x, ey.y);

  const bx = width > 1e-4 ? { x: ex.x / width, y: ex.y / width } : { x: 1, y: 0 };
  const by = height > 1e-4 ? { x: ey.x / height, y: ey.y / height } : { x: 0, y: 1 };
  const det = bx.x * by.y - bx.y * by.x;

  return { center, bx, by, width, height, det };
}

function toLocal(p: Point, frame: ReturnType<typeof quadFrame>) {
  const v = { x: p.x - frame.center.x, y: p.y - frame.center.y };
  if (Math.abs(frame.det) < 1e-4) {
    return {
      x: v.x * frame.bx.x + v.y * frame.bx.y,
      y: v.x * frame.by.x + v.y * frame.by.y,
    };
  }
  const x = (v.x * frame.by.y - v.y * frame.by.x) / frame.det;
  const y = (frame.bx.x * v.y - frame.bx.y * v.x) / frame.det;
  return { x, y };
}

function fromLocal(local: Point, frame: ReturnType<typeof quadFrame>): Point {
  return {
    x: frame.center.x + frame.bx.x * local.x + frame.by.x * local.y,
    y: frame.center.y + frame.bx.y * local.x + frame.by.y * local.y,
  };
}

function getTiltFocus(canvasW: number, canvasH: number) {
  const base = Math.max(canvasW, canvasH) * 0.9;
  return clamp(base, TILT_FOCUS_MIN, TILT_FOCUS_MAX);
}

function applyTiltToQuad(quad: Quad, tiltDeg: number, focus: number): Quad {
  if (Math.abs(tiltDeg) < 0.01) return quad;
  const frame = quadFrame(quad);
  const rad = (tiltDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const safeFocus = Math.max(60, focus);

  return quad.map((p) => {
    const local = toLocal(p, frame);
    const z = -local.y * sin;
    const denom = Math.max(80, safeFocus + z);
    const k = safeFocus / denom;
    const x = local.x * k;
    const y = local.y * cos * k;
    return fromLocal({ x, y }, frame);
  }) as Quad;
}

function screenPointToBase(p: Point, baseQuad: Quad, tiltDeg: number, focus: number): Point {
  if (Math.abs(tiltDeg) < 0.01) return p;
  const frame = quadFrame(baseQuad);
  const local = toLocal(p, frame);
  const rad = (tiltDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const denom = cos * focus + local.y * sin;
  if (Math.abs(denom) < 1e-4) return p;
  const y = (local.y * focus) / denom;
  const k = focus / Math.max(60, focus - y * sin);
  const x = local.x / k;
  return fromLocal({ x, y }, frame);
}

type TiltControl = {
  center: Point;
  radius: number;
  handle: Point;
  handleRadius: number;
  handleHitRadius: number;
  handleRange: number;
};

function getTiltControl(
  quad: Quad,
  tiltDeg: number,
  canvasW: number,
  canvasH: number,
  coarse: boolean
): TiltControl {
  const frame = quadFrame(quad);
  const radius = coarse ? 34 : 26;
  const offset = radius + (coarse ? 18 : 12);
  const centerCandidate = {
    x: frame.center.x + frame.bx.x * (frame.width / 2 + offset),
    y: frame.center.y + frame.bx.y * (frame.width / 2 + offset),
  };

  const center = {
    x: clamp(centerCandidate.x, radius + 12, canvasW - radius - 12),
    y: clamp(centerCandidate.y, radius + 12, canvasH - radius - 12),
  };

  const handleRange = radius * 0.85;
  const tiltNorm = clamp(tiltDeg / TILT_MAX, -1, 1);
  const handle = { x: center.x, y: center.y + tiltNorm * handleRange };
  const handleRadius = coarse ? 7 : 5;
  const handleHitRadius = coarse ? 20 : 12;

  return { center, radius, handle, handleRadius, handleHitRadius, handleRange };
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
  const videoTutorialSrc = isRu ? "/rugsvideo.mp4" : "/rugsvideo_en.mp4";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const uploadRef = useRef<HTMLLabelElement | null>(null);
  const articleBlockRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLInputElement | null>(null);
  const findRef = useRef<HTMLButtonElement | null>(null);
  const sizeRef = useRef<HTMLSelectElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const shadowRef = useRef<HTMLDivElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const compareRef = useRef<HTMLButtonElement | null>(null);
  const resetRef = useRef<HTMLButtonElement | null>(null);
  const downloadRef = useRef<HTMLButtonElement | null>(null);
  const formatRef = useRef<HTMLSelectElement | null>(null);
  const maskPanelRef = useRef<HTMLDivElement | null>(null);
  const videoTutorialAutoStartRef = useRef(false);

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
  const [videoTutorialOpen, setVideoTutorialOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const [layerA, setLayerA] = useState<LayerState>(() => createInitialLayer("A"));
  const [layerB, setLayerB] = useState<LayerState>(() => createInitialLayer("B"));

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

  const openVideoTutorial = useCallback(() => {
    setVideoTutorialOpen(true);
  }, []);

  const closeVideoTutorial = useCallback(() => {
    setVideoTutorialOpen(false);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(VR_VIDEO_TUTORIAL_SEEN_KEY, "1");
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (videoTutorialAutoStartRef.current) return;
    videoTutorialAutoStartRef.current = true;
    if (typeof window === "undefined") return;

    try {
      const hasSeen = window.localStorage.getItem(VR_VIDEO_TUTORIAL_SEEN_KEY);
      if (hasSeen) return;
    } catch {
      // ignore storage errors
    }

    const timer = window.setTimeout(() => {
      setVideoTutorialOpen(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!videoTutorialOpen) return;
    if (typeof document !== "undefined") {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }
  }, [videoTutorialOpen]);

  useEffect(() => {
    if (!videoTutorialOpen || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeVideoTutorial();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeVideoTutorial, videoTutorialOpen]);

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
    options: { includeGuides?: boolean; includeSplitLine?: boolean; includeMaskOverlay?: boolean; forExport?: boolean } = {}
  ) => {
    const { includeGuides = true, includeSplitLine = true, includeMaskOverlay = true, forExport = false } = options;
    const showGuides = forExport ? false : includeGuides;
    const showSplitLine = forExport ? false : includeSplitLine;
    const showMaskOverlay = forExport ? false : includeMaskOverlay;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawRoom(ctx, w, h);

    const focus = getTiltFocus(w, h);
    const quadA = layerA.quad ? applyTiltToQuad(layerA.quad, layerA.tiltX, focus) : null;
    const quadB = layerB.quad ? applyTiltToQuad(layerB.quad, layerB.tiltX, focus) : null;

    const drawLayer = (
      layer: LayerState,
      quad: Quad | null,
      clip?: { x: number; y: number; w: number; h: number }
    ) => {
      if (!layer.img || !quad) return;
      const maskOn = maskHasContentRef.current[layer.id];

      if (clip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(clip.x, clip.y, clip.w, clip.h);
        ctx.clip();
      }

      if (!maskOn) {
        if (layer.shadowOn) drawShadow(ctx, quad, layer.shadowPct);
        drawImageToQuad(ctx, layer.img, quad, 18);
      } else {
        const scratch = ensureScratchCanvas(w, h);
        const sctx = scratch.getContext("2d");
        if (!sctx) return;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, w, h);
        if (layer.shadowOn) drawShadow(sctx, quad, layer.shadowPct);
        drawImageToQuad(sctx, layer.img, quad, 18);
        sctx.globalCompositeOperation = "destination-out";
        const mask = getMaskCanvas(layer.id, w, h);
        sctx.drawImage(mask, 0, 0, w, h);
        sctx.globalCompositeOperation = "source-over";
        ctx.drawImage(scratch, 0, 0, w, h);
      }

      if (showMaskOverlay && layer.maskVisible && maskOn) {
        const scratch = ensureScratchCanvas(w, h);
        const sctx = scratch.getContext("2d");
        if (sctx) {
          sctx.setTransform(1, 0, 0, 1, 0, 0);
          sctx.clearRect(0, 0, w, h);
          const mask = getMaskCanvas(layer.id, w, h);
          sctx.drawImage(mask, 0, 0, w, h);
          sctx.globalCompositeOperation = "source-in";
          sctx.fillStyle = "rgba(239, 68, 68, 0.55)";
          sctx.fillRect(0, 0, w, h);
          sctx.globalCompositeOperation = "source-over";
          ctx.save();
          ctx.globalAlpha = 0.65;
          ctx.drawImage(scratch, 0, 0, w, h);
          ctx.restore();
        }
      }

      if (clip) ctx.restore();
    };

    const la = layerA;
    const lb = layerB;

    if (compareMode && la.img && quadA && lb.img && quadB) {
      drawLayer(la, quadA);
      const splitX = (compareSplit / 100) * w;
      drawLayer(lb, quadB, { x: splitX, y: 0, w: w - splitX, h });

      if (showSplitLine) {
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
      drawLayer(la, quadA);
      drawLayer(lb, quadB);
    }

    if (showGuides) {
      const act = active === "A" ? la : lb;
      const actQuad = active === "A" ? quadA : quadB;
      if (act.quad && actQuad) {
        const cornerRadius = isCoarsePointer ? 12 : 7;
        const rotateRadius = isCoarsePointer ? 14 : 9;
        const rotateOffset = isCoarsePointer ? 64 : 46;
        const center = centerOfQuad(act.quad);
        const rotatePos = rotateHandlePosition(actQuad, rotateOffset, center);

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
        for (const p of actQuad) {
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

        const tiltControl = getTiltControl(actQuad, act.tiltX, w, h, isCoarsePointer);
        const tiltActive = dragRef.current.mode === "tilt";
        let arrowDir = {
          x: tiltControl.handle.x - tiltControl.center.x,
          y: tiltControl.handle.y - tiltControl.center.y,
        };
        let arrowLen = Math.hypot(arrowDir.x, arrowDir.y);
        if (arrowLen < 1e-3) {
          arrowDir = { x: 0, y: -1 };
          arrowLen = 1;
        }
        const ux = arrowDir.x / arrowLen;
        const uy = arrowDir.y / arrowLen;
        const perp = { x: -uy, y: ux };
        const headSize = isCoarsePointer ? 9 : 7;

        ctx.save();
        ctx.lineWidth = isCoarsePointer ? 3 : 2;
        ctx.strokeStyle = tiltActive ? "rgba(17,24,39,0.9)" : "rgba(17,24,39,0.6)";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath();
        ctx.arc(tiltControl.center.x, tiltControl.center.y, tiltControl.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = tiltActive ? "rgba(17,24,39,0.95)" : "rgba(17,24,39,0.7)";
        ctx.beginPath();
        ctx.moveTo(tiltControl.center.x, tiltControl.center.y);
        ctx.lineTo(tiltControl.handle.x, tiltControl.handle.y);
        ctx.stroke();

        const tip = tiltControl.handle;
        const left = {
          x: tip.x - ux * headSize + perp.x * headSize * 0.7,
          y: tip.y - uy * headSize + perp.y * headSize * 0.7,
        };
        const right = {
          x: tip.x - ux * headSize - perp.x * headSize * 0.7,
          y: tip.y - uy * headSize - perp.y * headSize * 0.7,
        };
        ctx.fillStyle = tiltActive ? "#111827" : "#1f2937";
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, tiltControl.handleRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "rgba(17,24,39,0.85)";
        ctx.font = `${isCoarsePointer ? 12 : 11}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const tiltLabel = isRu ? "Наклон" : "Tilt";
        const tiltValue = `${Math.round(act.tiltX)}\u00b0`;
        ctx.fillText(
          `${tiltLabel}: ${tiltValue}`,
          tiltControl.center.x + tiltControl.radius + 10,
          tiltControl.center.y
        );
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
  }, [roomImg, layerA, layerB, compareMode, compareSplit, active, isCoarsePointer]);

  // Interaction
  const dragRef = useRef<{
    mode: DragMode;
    cornerIndex: number;
    last: Point;
    pointerId: number | null;
    startAngle: number;
    startRotate: number;
    center: Point | null;
    tiltCenter: Point | null;
    tiltRange: number;
  }>({
    mode: "none",
    cornerIndex: -1,
    last: { x: 0, y: 0 },
    pointerId: null,
    startAngle: 0,
    startRotate: 0,
    center: null,
    tiltCenter: null,
    tiltRange: 1,
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
    const canvas = e.currentTarget;
    const focus = getTiltFocus(canvas.width, canvas.height);
    const displayQuad = applyTiltToQuad(act.quad, act.tiltX, focus);
    const tiltControl = getTiltControl(displayQuad, act.tiltX, canvas.width, canvas.height, isTouchInput);

    if (pointersRef.current.size >= 2) {
      if (!act.maskEditing) beginGesture(act);
      dragRef.current.mode = "none";
      dragRef.current.pointerId = null;
      dragRef.current.tiltCenter = null;
      dragRef.current.tiltRange = 1;
      return;
    }

    if (dist(p, tiltControl.handle) <= tiltControl.handleHitRadius) {
      dragRef.current = {
        mode: "tilt",
        cornerIndex: -1,
        last: p,
        pointerId: e.pointerId,
        startAngle: 0,
        startRotate: 0,
        center: null,
        tiltCenter: tiltControl.center,
        tiltRange: tiltControl.handleRange,
      };
      scheduleDraw();
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
        tiltCenter: null,
        tiltRange: 1,
      };
      drawMaskStroke(active, p, p, act.maskBrush, act.maskMode);
      return;
    }

    const cornerHit = isTouchInput ? 32 : 14;
    const rotateHit = isTouchInput ? 36 : 16;
    const rotateOffset = isTouchInput ? 64 : 46;
    const rotatePos = rotateHandlePosition(displayQuad, rotateOffset, centerOfQuad(act.quad));

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
        tiltCenter: null,
        tiltRange: 1,
      };
      return;
    }

    for (let i = 0; i < 4; i++) {
      if (dist(p, displayQuad[i]) <= cornerHit) {
        dragRef.current = {
          mode: "corner",
          cornerIndex: i,
          last: p,
          pointerId: e.pointerId,
          startAngle: 0,
          startRotate: 0,
          center: null,
          tiltCenter: null,
          tiltRange: 1,
        };
        return;
      }
    }

    if (pointInQuad(p, displayQuad)) {
      dragRef.current = {
        mode: "move",
        cornerIndex: -1,
        last: p,
        pointerId: e.pointerId,
        startAngle: 0,
        startRotate: 0,
        center: null,
        tiltCenter: null,
        tiltRange: 1,
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

    const d = dragRef.current;
    if (d.mode === "tilt" && d.pointerId === e.pointerId && d.tiltCenter) {
      const range = Math.max(1, d.tiltRange || 1);
      const nextTilt = clamp(((p.y - d.tiltCenter.y) / range) * TILT_MAX, TILT_MIN, TILT_MAX);
      applyTilt(active, nextTilt);
      return;
    }

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
      const canvas = canvasRef.current;
      const focus = canvas ? getTiltFocus(canvas.width, canvas.height) : TILT_FOCUS_MAX;
      next.quad![d.cornerIndex] = screenPointToBase(p, act.quad, act.tiltX, focus);
    } else if (d.mode === "move") {
      next.quad = next.quad!.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) as Quad;
    }

    setLayer(active, next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2 && gestureRef.current.active) endGesture();
    if (dragRef.current.pointerId === e.pointerId) {
      const wasTilt = dragRef.current.mode === "tilt";
      dragRef.current.mode = "none";
      dragRef.current.cornerIndex = -1;
      dragRef.current.pointerId = null;
      dragRef.current.tiltCenter = null;
      dragRef.current.tiltRange = 1;
      if (wasTilt) scheduleDraw();
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

  const applyTilt = (id: LayerId, nextDeg: number) => {
    const layer = getLayer(id);
    const clamped = clamp(nextDeg, TILT_MIN, TILT_MAX);
    if (clamped === layer.tiltX) return;
    setLayer(id, { ...layer, tiltX: clamped });
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
        tiltX: 0,
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
       renderScene(octx, out.width, out.height, { forExport: true });

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

  const resetWorkspace = () => {
    const initialA = createInitialLayer("A");
    const initialB = createInitialLayer("B");

    if (isCoarsePointer) {
      initialA.maskBrush = 40;
      initialB.maskBrush = 40;
    }

    pointersRef.current.clear();
    gestureRef.current = {
      active: false,
      pointerIds: null,
      startDist: 1,
      startAngle: 0,
      startScale: 100,
      startRotate: 0,
    };
    dragRef.current = {
      mode: "none",
      cornerIndex: -1,
      last: { x: 0, y: 0 },
      pointerId: null,
      startAngle: 0,
      startRotate: 0,
      center: null,
      tiltCenter: null,
      tiltRange: 1,
    };

    setError(null);
    setLoading(null);
    setActive("A");
    setCompareMode(false);
    setCompareSplit(50);
    setDownloadFormat("png");
    setLayerA(initialA);
    setLayerB(initialB);
    setRoomImg(null);
    setRoomUrlSafe(null);
    resetMasks();
  };

  const sizeOptions = (p: RugProduct | null) =>
    (p?.sizes ?? []).filter((s) => !/özel\s*ölçü|ozel\s*olcu/i.test(s));

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-gray-200 flex items-center justify-between gap-3">
        <div>
          <h3 ref={titleRef} data-tour="vr-title" className="text-lg font-semibold text-gray-900">
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
            ref={compareRef}
            data-tour="compare-mode"
            type="button"
            onClick={() => setCompareMode((v) => !v)}
            className="h-10 px-4 rounded-lg border border-gray-300 text-gray-800 text-sm font-semibold hover:bg-gray-50 whitespace-nowrap"
          >
            {compareMode ? (isRu ? "Обычный режим" : "Normal") : (isRu ? "Сравнение" : "Compare")}
          </button>
          <button
            ref={resetRef}
            data-tour="reset"
            type="button"
            onClick={resetWorkspace}
            className="h-10 px-4 rounded-lg border border-gray-300 text-gray-800 text-sm font-semibold hover:bg-gray-50 whitespace-nowrap"
          >
            {isRu ? "Сброс" : "Reset"}
          </button>
          <button
            type="button"
            onClick={openVideoTutorial}
            className="h-10 px-4 rounded-lg border border-gray-300 text-gray-800 text-sm font-semibold hover:bg-gray-50 whitespace-nowrap"
          >
            {isRu ? "Обучение" : "Help"}
          </button>
          <select
            ref={formatRef}
            data-tour="download-format"
            id="vr-download-format"
            className="h-10 px-2 rounded-lg border border-gray-300 bg-white text-sm"
            value={downloadFormat}
            onChange={(e) => setDownloadFormat(e.target.value as "png" | "jpg")}
          >
            <option value="png">PNG</option>
            <option value="jpg">JPG</option>
          </select>
          <button
            ref={downloadRef}
            data-tour="export"
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
          <div ref={hostRef} data-tour="canvas-host" className="min-h-[420px] md:min-h-[560px] rounded-xl border border-gray-200 bg-gray-50 overflow-hidden relative">
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
            <label
              ref={uploadRef}
              data-tour="upload-photo"
              className="inline-flex items-center justify-center h-11 px-4 rounded-lg bg-black text-white font-semibold cursor-pointer hover:bg-black/90"
            >
              {isRu ? "Загрузить фото" : "Upload photo"}
              <input
                data-tour="upload-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onRoomFile(e.target.files?.[0] ?? null)}
              />
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

              <div data-tour="choose-rug" className="mt-3">
                <label className="text-xs font-semibold uppercase text-gray-600">
                  {isRu ? "Артикул" : "Article"}
                </label>

                <div ref={articleBlockRef} data-tour="article-find" className="mt-1 flex flex-col gap-2">
                  <input
                    ref={articleRef}
                    data-tour="article-input"
                    className="h-10 px-4 rounded-lg bg-black text-white font-semibold hover:bg-black/90"
                    value={activeLayer.article}
                    onChange={(e) => setLayer(active, { ...activeLayer, article: e.target.value })}
                    placeholder={isRu ? "Например: 2025-C-4395" : "e.g. 2025-C-4395"}
                  />
                  <button
                    ref={findRef}
                    data-tour="find-button"
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
                  ref={sizeRef}
                  data-tour="size-select"
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

              
              
              <div ref={settingsRef} data-tour="transform-controls" className="mt-4 space-y-3">
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

                <div ref={shadowRef}>
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

                <div ref={maskPanelRef} data-tour="mask-controls">
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

                  <div data-tour="show-mask" className="mt-2 flex items-center justify-between text-xs text-gray-600">
                    <span>{isRu ? "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043c\u0430\u0441\u043a\u0443" : "Show mask"}</span>
                    <label className="inline-flex items-center gap-2 select-none">
                      <input
                        data-tour="show-mask"
                        type="checkbox"
                        checked={activeLayer.maskVisible}
                        onChange={(e) => setLayer(active, { ...activeLayer, maskVisible: e.target.checked })}
                      />
                      <span>{isRu ? "\u0412\u0438\u0434\u043d\u043e" : "Show"}</span>
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

              <div ref={hintRef} className="mt-4 text-xs text-gray-500">
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

      {isMounted && videoTutorialOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 bg-black/70 p-4 sm:p-6 flex items-center justify-center"
              onClick={closeVideoTutorial}
            >
              <div
                className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200">
                  <h4 className="text-sm md:text-base font-semibold text-gray-900">
                    {isRu ? "Видеообучение VR примерке" : "VR video tutorial"}
                  </h4>
                  <button
                    type="button"
                    onClick={closeVideoTutorial}
                    className="h-9 px-3 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    {isRu ? "Закрыть" : "Close"}
                  </button>
                </div>
                <div className="p-3 sm:p-4 bg-black">
                  <video
                    src={videoTutorialSrc}
                    controls
                    autoPlay
                    className="w-full aspect-video rounded-lg"
                  >
                    {isRu
                      ? "Ваш браузер не поддерживает видео. Откройте файл /rugsvideo.mp4."
                      : `Your browser does not support video. Open ${videoTutorialSrc}.`}
                  </video>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

