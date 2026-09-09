import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, PointerEvent } from 'react';
import { constrainCamera, fitBoard, pinchScale, wheelScale, zoomAt } from './camera.js';
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
  const pointers = useRef(new Map<number, { x: number; y: number; startX: number; startY: number }>());
  const suppressClick = useRef(false),
    pinch = useRef<{ distance: number; middle: { x: number; y: number } } | null>(null);
  function move(next: Camera) {
    current.current = constrainCamera(next, bounds.current);
    setCamera(current.current);
  }
  function stopGlide() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    target.current = current.current;
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
      if (document.hidden) stopGlide();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
      document.removeEventListener('visibilitychange', hidden);
      stopGlide();
    };
  }, []);
  function setPinch() {
    const points = [...pointers.current.values()];
    pinch.current =
      points.length === 2
        ? {
            distance: Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y),
            middle: { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 },
          }
        : null;
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    stopGlide();
    if (!pointers.current.size) suppressClick.current = false;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    });
    if (pointers.current.size === 2) {
      suppressClick.current = true;
      setPinch();
    }
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const old = pointers.current.get(event.pointerId);
    if (!old) return;
    const dx = event.clientX - old.x,
      dy = event.clientY - old.y;
    const dragged = Math.hypot(event.clientX - old.startX, event.clientY - old.startY) > 6;
    pointers.current.set(event.pointerId, { ...old, x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const previous = pinch.current;
      setPinch();
      const next = pinch.current!;
      const rect = viewport.current!.getBoundingClientRect();
      move(
        zoomAt(
          {
            ...current.current,
            x: current.current.x + next.middle.x - previous.middle.x,
            y: current.current.y + next.middle.y - previous.middle.y,
          },
          pinchScale(current.current.scale, next.distance, previous.distance),
          { x: next.middle.x - rect.left - rect.width / 2, y: next.middle.y - rect.top - rect.height / 2 },
          bounds.current,
        ),
      );
      suppressClick.current = true;
    } else if (dragged || suppressClick.current) {
      suppressClick.current = true;
      move({ ...current.current, x: current.current.x + dx, y: current.current.y + dy });
    }
    target.current = current.current;
    if (suppressClick.current) {
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  }
  function release(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    if (!pointers.current.size) setDragging(false);
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
      onLostPointerCapture={release}
      onClickCapture={(event) => {
        if (suppressClick.current && !(event.target as Element).closest('button')) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !['+', '=', '-', '0'].includes(event.key)) return;
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
                  <image href="/art/environment-dark.png" width="1024" height="1024" />
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
