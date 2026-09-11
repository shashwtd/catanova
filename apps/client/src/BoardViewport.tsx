import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, PointerEvent } from 'react';
import { BoardGesture, constrainCamera, fitBoard, wheelScale, zoomAt } from './camera.js';
import type { Bounds, Camera } from './camera.js';
import { MATERIAL_GUTTER, MATERIAL_QUADRANTS, WORLD } from './scene.js';

export function BoardViewport({
  seed,
  children,
  reducedMotion = false,
}: {
  seed: number;
  children: ReactNode;
  reducedMotion?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    current = useRef<Camera>({ scale: 1, x: 0, y: 0 }),
    target = useRef(current.current),
    bounds = useRef<Bounds>({ width: 1, height: 1 }),
    origin = useRef({ x: 0, y: 0 }),
    frame = useRef<number | null>(null),
    quiet = useRef(reducedMotion);
  quiet.current = reducedMotion;
  const patternId = `table-${useId().replaceAll(':', '')}`;
  const [camera, setCamera] = useState(current.current),
    [dragging, setDragging] = useState(false);
  const gesture = useRef(new BoardGesture());
  function move(next: Camera) {
    current.current = constrainCamera(next, bounds.current);
    setCamera(current.current);
  }
  function stopGlide() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    target.current = current.current;
  }
  function clearGesture() {
    const ids = gesture.current.pointerIds;
    gesture.current.cancel();
    setDragging(false);
    for (const id of ids) {
      if (viewport.current?.hasPointerCapture(id)) viewport.current.releasePointerCapture(id);
    }
  }
  function glide(next: Camera) {
    target.current = constrainCamera(next, bounds.current);
    if (quiet.current) {
      move(target.current);
      return;
    }
    if (frame.current !== null) return;
    let previousTime = 0;
    const step = (time: number) => {
      const dt = previousTime ? Math.min(32, time - previousTime) : 16;
      previousTime = time;
      const blend = 1 - Math.exp(-dt / 42),
        before = current.current,
        after = target.current;
      if (
        Math.abs(before.scale - after.scale) < 0.0003 &&
        Math.hypot(before.x - after.x, before.y - after.y) < 0.15
      ) {
        move(after);
        frame.current = null;
        return;
      }
      move({
        scale: before.scale + (after.scale - before.scale) * blend,
        x: before.x + (after.x - before.x) * blend,
        y: before.y + (after.y - before.y) * blend,
      });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }
  useEffect(() => {
    clearGesture();
    stopGlide();
    move({ scale: 1, x: 0, y: 0 });
    target.current = current.current;
  }, [seed]);
  useEffect(() => {
    if (reducedMotion) {
      const next = target.current;
      stopGlide();
      move(next);
      target.current = current.current;
    }
  }, [reducedMotion]);
  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      bounds.current = { width: rect.width, height: rect.height };
      origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      clearGesture();
      stopGlide();
      move(current.current);
      target.current = current.current;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('button')) return;
      event.preventDefault();
      if (gesture.current.pointerIds.length) return;
      const rect = element.getBoundingClientRect();
      const delta =
        event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
      glide(
        zoomAt(
          target.current,
          wheelScale(target.current.scale, delta),
          { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 },
          bounds.current,
        ),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    const hidden = () => {
      if (document.hidden) {
        clearGesture();
        stopGlide();
      }
    };
    const blurred = () => {
      clearGesture();
      stopGlide();
    };
    // Mouse contacts have no implicit capture until dragging begins. A release just
    // outside the viewport must still retire a contact that never crossed the slop.
    const outsideRelease = (event: globalThis.PointerEvent) => {
      if (!gesture.current.has(event.pointerId)) return;
      gesture.current.end(event.pointerId, current.current);
      setDragging(gesture.current.dragging);
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', blurred);
    window.addEventListener('pointerup', outsideRelease);
    window.addEventListener('pointercancel', outsideRelease);
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blurred);
      window.removeEventListener('pointerup', outsideRelease);
      window.removeEventListener('pointercancel', outsideRelease);
      gesture.current.cancel();
      stopGlide();
    };
  }, []);
  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  }
  function captureGesture(event: PointerEvent<HTMLDivElement>) {
    if (!gesture.current.dragging) return;
    setDragging(true);
    for (const id of gesture.current.pointerIds) {
      if (!event.currentTarget.hasPointerCapture(id)) event.currentTarget.setPointerCapture(id);
    }
    event.preventDefault();
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    stopGlide();
    gesture.current.start(event.pointerId, point(event), current.current);
    captureGesture(event);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!gesture.current.has(event.pointerId)) return;
    const next = gesture.current.update(event.pointerId, point(event), current.current, bounds.current);
    if (next) move(next);
    target.current = current.current;
    captureGesture(event);
  }
  function release(event: PointerEvent<HTMLDivElement>) {
    gesture.current.end(event.pointerId, current.current);
    setDragging(gesture.current.dragging);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const fitted = fitBoard(bounds.current);
  return (
    <div
      ref={viewport}
      className="board-viewport"
      data-dragging={dragging}
      tabIndex={0}
      aria-label="Island and table. Scroll or pinch to zoom; drag to pan; plus and minus zoom."
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={(event) => {
        // Touch initially captures its SVG hit target. Its bubbling capture-loss event
        // during transfer to this viewport must not end the still-active gesture.
        if (
          gesture.current.captureLost(event.pointerId, current.current, {
            fromViewport: event.target === event.currentTarget,
            stillCaptured: event.currentTarget.hasPointerCapture(event.pointerId),
          })
        )
          setDragging(gesture.current.dragging);
      }}
      onClickCapture={(event) => {
        if (gesture.current.blocksClick(event.detail)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !['+', '=', '-', '0'].includes(event.key)) return;
        if (gesture.current.pointerIds.length) return;
        event.preventDefault();
        if (event.key === '0') glide({ scale: 1, x: 0, y: 0 });
        else
          glide(
            zoomAt(
              target.current,
              target.current.scale + (event.key === '-' ? -0.07 : 0.07),
              { x: 0, y: 0 },
              bounds.current,
            ),
          );
      }}
    >
      <svg className="board-world-surface" aria-hidden="true">
        <defs>
          <pattern
            id={patternId}
            width="720"
            height="720"
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${origin.current.x + camera.x} ${origin.current.y + camera.y}) scale(${camera.scale})`}
          >
            {MATERIAL_QUADRANTS.map(({ x, y, sx, sy }, index) => (
              <g key={index} transform={`translate(${x * 360} ${y * 360}) scale(${sx} ${sy})`}>
                <svg
                  width="360"
                  height="360"
                  viewBox={`${512 + MATERIAL_GUTTER} ${512 + MATERIAL_GUTTER} ${512 - MATERIAL_GUTTER * 2} ${512 - MATERIAL_GUTTER * 2}`}
                >
                  <image
                    href="/art/optimized/environment-dark.c55c6de597e4.webp"
                    width="1024"
                    height="1024"
                  />
                </svg>
              </g>
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        <rect width="100%" height="100%" fill="#241d271a" />
      </svg>
      <div
        className="board-camera"
        style={{
          width: fitted.width,
          height: fitted.height,
          aspectRatio: `${WORLD.width}/${WORLD.height}`,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
