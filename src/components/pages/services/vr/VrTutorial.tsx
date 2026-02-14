"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type VrTutorialStep = {
  id: string;
  text: string;
  statusNote?: string;
  allowNoTarget?: boolean;
  autoAdvance?: boolean;
};

type NormalizedRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type VrTutorialProps = {
  isOpen: boolean;
  locale: "ru" | "en";
  steps: VrTutorialStep[];
  getTargetRect: (stepId: string) => DOMRect | null;
  onClose: () => void;
  onStepChange?: (stepIndex: number) => void;
};

const MOBILE_BREAKPOINT = 768;
const PANEL_MARGIN = 16;
const HIGHLIGHT_PADDING = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(rawRect: DOMRect, viewportWidth: number, viewportHeight: number): NormalizedRect | null {
  if (rawRect.width <= 0 || rawRect.height <= 0) return null;
  const left = clamp(rawRect.left - HIGHLIGHT_PADDING, 0, viewportWidth);
  const right = clamp(rawRect.right + HIGHLIGHT_PADDING, 0, viewportWidth);
  const top = clamp(rawRect.top - HIGHLIGHT_PADDING, 0, viewportHeight);
  const bottom = clamp(rawRect.bottom + HIGHLIGHT_PADDING, 0, viewportHeight);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width <= 0 || height <= 0) return null;
  return { top, left, right, bottom, width, height };
}

function getBottomSheetStyle(): React.CSSProperties {
  return {
    left: PANEL_MARGIN,
    right: PANEL_MARGIN,
    bottom: PANEL_MARGIN,
  };
}

export default function VrTutorial({
  isOpen,
  locale,
  steps,
  getTargetRect,
  onClose,
  onStepChange,
}: VrTutorialProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [highlightRect, setHighlightRect] = useState<NormalizedRect | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>(() => getBottomSheetStyle());

  const getStepRect = useCallback(
    (index: number): DOMRect | null => {
      const step = steps[index];
      if (!step) return null;
      const rect = getTargetRect(step.id);
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return rect;
    },
    [getTargetRect, steps]
  );

  const isStepAvailable = useCallback(
    (index: number) => {
      const step = steps[index];
      if (!step) return false;
      if (step.allowNoTarget) return true;
      return getStepRect(index) !== null;
    },
    [getStepRect, steps]
  );

  const findStep = useCallback(
    (start: number, direction: 1 | -1) => {
      if (!steps.length) return -1;
      for (let i = start; i >= 0 && i < steps.length; i += direction) {
        if (isStepAvailable(i)) return i;
      }
      return -1;
    },
    [isStepAvailable, steps.length]
  );

  const scrollStepIntoView = useCallback(
    (index: number) => {
      const step = steps[index];
      if (!step || typeof document === "undefined") return;

      const target = document.querySelector(`[data-tour="${step.id}"]`);
      if (!(target instanceof HTMLElement)) return;

      const rect = target.getBoundingClientRect();
      const visibleTop = PANEL_MARGIN;
      const visibleBottom = window.innerHeight - PANEL_MARGIN;
      const isVisible = rect.top >= visibleTop && rect.bottom <= visibleBottom;
      if (isVisible) return;

      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
        inline: "nearest",
      });
    },
    [steps]
  );

  const placePanel = useCallback((target: NormalizedRect | null, viewportWidth: number, viewportHeight: number) => {
    const panel = panelRef.current;
    if (!panel) {
      setPanelStyle(getBottomSheetStyle());
      return;
    }

    const panelRect = panel.getBoundingClientRect();
    const panelWidth = Math.min(Math.max(panelRect.width, 280), viewportWidth - PANEL_MARGIN * 2);
    const panelHeight = panelRect.height || 220;

    if (viewportWidth < MOBILE_BREAKPOINT || !target) {
      setPanelStyle(getBottomSheetStyle());
      return;
    }

    const topBound = Math.max(PANEL_MARGIN, viewportHeight - panelHeight - PANEL_MARGIN);
    const alignedTop = clamp(target.top, PANEL_MARGIN, topBound);
    const rightPlacement = target.right + PANEL_MARGIN;
    if (rightPlacement + panelWidth <= viewportWidth - PANEL_MARGIN) {
      setPanelStyle({ top: alignedTop, left: rightPlacement, width: panelWidth });
      return;
    }

    const leftPlacement = target.left - panelWidth - PANEL_MARGIN;
    if (leftPlacement >= PANEL_MARGIN) {
      setPanelStyle({ top: alignedTop, left: leftPlacement, width: panelWidth });
      return;
    }

    const alignedLeft = clamp(target.left, PANEL_MARGIN, Math.max(PANEL_MARGIN, viewportWidth - panelWidth - PANEL_MARGIN));
    const bottomPlacement = target.bottom + PANEL_MARGIN;
    if (bottomPlacement + panelHeight <= viewportHeight - PANEL_MARGIN) {
      setPanelStyle({ top: bottomPlacement, left: alignedLeft, width: panelWidth });
      return;
    }

    const upperPlacement = target.top - panelHeight - PANEL_MARGIN;
    if (upperPlacement >= PANEL_MARGIN) {
      setPanelStyle({ top: upperPlacement, left: alignedLeft, width: panelWidth });
      return;
    }

    setPanelStyle(getBottomSheetStyle());
  }, []);

  const recompute = useCallback(() => {
    if (!isOpen) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    setViewport({ width: viewportWidth, height: viewportHeight });
    const rawRect = getStepRect(stepIndex);
    const nextRect = rawRect ? normalizeRect(rawRect, viewportWidth, viewportHeight) : null;
    setHighlightRect(nextRect);
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      placePanel(nextRect, viewportWidth, viewportHeight);
    });
  }, [getStepRect, isOpen, placePanel, stepIndex]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const firstStep = findStep(0, 1);
    setStepIndex(firstStep === -1 ? 0 : firstStep);
  }, [findStep, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!steps.length) {
      onClose();
      return;
    }

    const step = steps[stepIndex];
    if (!step) {
      const firstStep = findStep(0, 1);
      if (firstStep !== -1) {
        setStepIndex(firstStep);
        return;
      }
      onClose();
      return;
    }

    if (isStepAvailable(stepIndex)) return;
    const next = findStep(stepIndex + 1, 1);
    if (next !== -1) {
      setStepIndex(next);
      return;
    }
    const prev = findStep(stepIndex - 1, -1);
    if (prev !== -1) {
      setStepIndex(prev);
      return;
    }
    onClose();
  }, [findStep, isOpen, isStepAvailable, onClose, stepIndex, steps]);

  useEffect(() => {
    if (!isOpen) return;
    onStepChange?.(stepIndex);
  }, [isOpen, onStepChange, stepIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const step = steps[stepIndex];
    if (!step?.autoAdvance) return;
    const next = findStep(stepIndex + 1, 1);
    if (next === -1) return;
    const timer = window.setTimeout(() => setStepIndex(next), 180);
    return () => window.clearTimeout(timer);
  }, [findStep, isOpen, stepIndex, steps]);

  useEffect(() => {
    if (!isOpen) return;

    scrollStepIntoView(stepIndex);
    const timer = window.setTimeout(() => recompute(), 220);
    return () => window.clearTimeout(timer);
  }, [isOpen, recompute, scrollStepIntoView, stepIndex]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    recompute();
    const onViewportUpdate = () => recompute();
    window.addEventListener("resize", onViewportUpdate);
    window.addEventListener("scroll", onViewportUpdate, true);
    return () => {
      window.removeEventListener("resize", onViewportUpdate);
      window.removeEventListener("scroll", onViewportUpdate, true);
    };
  }, [isOpen, recompute]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const labels = useMemo(
    () =>
      locale === "ru"
        ? {
            step: "Шаг",
            back: "Назад",
            next: "Далее",
            skip: "Пропустить",
            finish: "Завершить",
          }
        : {
            step: "Step",
            back: "Back",
            next: "Next",
            skip: "Skip",
            finish: "Finish",
          },
    [locale]
  );

  if (!isOpen || !steps.length || !steps[stepIndex]) return null;

  const currentStep = steps[stepIndex];
  const prevIndex = findStep(stepIndex - 1, -1);
  const nextIndex = findStep(stepIndex + 1, 1);
  const isLastStep = nextIndex === -1;
  const viewportWidth = viewport.width || 0;
  const viewportHeight = viewport.height || 0;

  const goPrev = () => {
    if (prevIndex !== -1) setStepIndex(prevIndex);
  };

  const goNext = () => {
    if (isLastStep) {
      onClose();
      return;
    }
    if (nextIndex !== -1) setStepIndex(nextIndex);
  };

  return (
    <>
      {highlightRect ? (
        <>
          <div
            className="fixed z-50 pointer-events-none bg-black/55"
            style={{ top: 0, left: 0, width: "100vw", height: Math.max(0, highlightRect.top) }}
          />
          <div
            className="fixed z-50 pointer-events-none bg-black/55"
            style={{
              top: highlightRect.top,
              left: 0,
              width: Math.max(0, highlightRect.left),
              height: highlightRect.height,
            }}
          />
          <div
            className="fixed z-50 pointer-events-none bg-black/55"
            style={{
              top: highlightRect.top,
              left: highlightRect.right,
              width: Math.max(0, viewportWidth - highlightRect.right),
              height: highlightRect.height,
            }}
          />
          <div
            className="fixed z-50 pointer-events-none bg-black/55"
            style={{
              top: highlightRect.bottom,
              left: 0,
              width: "100vw",
              height: Math.max(0, viewportHeight - highlightRect.bottom),
            }}
          />
          <div
            className="fixed z-50 pointer-events-none rounded-xl border-2 border-white"
            style={{
              top: highlightRect.top,
              left: highlightRect.left,
              width: highlightRect.width,
              height: highlightRect.height,
            }}
          />
        </>
      ) : (
        <div className="fixed inset-0 z-50 pointer-events-none bg-black/55" />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-live="polite"
        className="fixed z-50 pointer-events-auto rounded-xl border border-gray-200 bg-white p-4 shadow-2xl"
        style={{
          ...panelStyle,
          maxHeight: viewportHeight > 0 ? Math.max(220, viewportHeight - PANEL_MARGIN * 2) : undefined,
          overflowY: "auto",
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {labels.step} {stepIndex + 1} / {steps.length}
        </p>
        <p className="mt-2 text-sm leading-6 text-gray-800">{currentStep.text}</p>
        {currentStep.statusNote ? <p className="mt-2 text-xs font-medium text-emerald-700">{currentStep.statusNote}</p> : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3 text-sm font-semibold text-gray-600 hover:bg-gray-100"
          >
            {labels.skip}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={prevIndex === -1}
              className={`h-9 rounded-lg border px-3 text-sm font-semibold ${
                prevIndex === -1
                  ? "cursor-not-allowed border-gray-200 text-gray-400"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {labels.back}
            </button>
            <button
              type="button"
              onClick={goNext}
              className="h-9 rounded-lg bg-black px-3 text-sm font-semibold text-white hover:bg-black/90"
            >
              {isLastStep ? labels.finish : labels.next}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
