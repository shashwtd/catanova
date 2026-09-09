import { useEffect, useRef, useState } from 'react';
import type { ReactNode, PointerEvent } from 'react';
import { Focus } from 'lucide-react';
import { constrainCamera, dragTilt, REST_PITCH, pinchScale, wheelScale, zoomAt } from './camera.js';
import type { Bounds, BoardTilt, Camera } from './camera.js';
export function BoardViewport({
  seed,
  children,
  depth = true,
  tilt = true,
  reducedMotion = false,
}: {
  seed: number;
  children: ReactNode;
  depth?: boolean;
  tilt?: boolean;
  reducedMotion?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    current = useRef<Camera>({ scale: 1, x: 0, y: 0 }),
    bounds = useRef<Bounds>({ width: 1, height: 1 });
  const [camera, setCamera] = useState(current.current);
  const [systemReduced, setSystemReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const allowTilt = depth && tilt && !reducedMotion && !systemReduced;
  const inclination = useRef<BoardTilt>({ pitch: REST_PITCH, yaw: 0 });
  const [angle, setAngle] = useState(inclination.current);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number; startX: number; startY: number }>());
  const suppressClick = useRef(false),
    pinch = useRef<{ distance: number; middle: { x: number; y: number } } | null>(null);
  function move(next: Camera) {
    current.current = constrainCamera(next, bounds.current);
    setCamera(current.current);
  }
  function reset() {
    move({ scale: 1, x: 0, y: 0 });
    inclination.current = { pitch: REST_PITCH, yaw: 0 };
    setAngle(inclination.current);
  }
  useEffect(reset, [seed]);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSystemReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!allowTilt) {
      inclination.current = { pitch: REST_PITCH, yaw: 0 };
      setAngle(inclination.current);
    }
  }, [allowTilt]);
  useEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      bounds.current = { width: rect.width, height: rect.height };
      move(current.current);
    });
    observer.observe(element);
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('button')) return;
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      move(
        zoomAt(
          current.current,
          wheelScale(current.current.scale, delta),
          { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 },
          bounds.current,
        ),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  }, []);
  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    if (!pointers.current.size) suppressClick.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    if (pointers.current.size === 2) {
      suppressClick.current = true;
      setPinch();
    }
  }
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
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    const old = pointers.current.get(e.pointerId);
    if (!old) return;
    const dx = e.clientX - old.x,
      dy = e.clientY - old.y;
    const dragged = Math.hypot(e.clientX - old.startX, e.clientY - old.startY) > 6;
    pointers.current.set(e.pointerId, { ...old, x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const previous = pinch.current;
      setPinch();
      const next = pinch.current!;
      const rect = viewport.current!.getBoundingClientRect();
      const scale = pinchScale(current.current.scale, next.distance, previous.distance);
      move(
        zoomAt(
          {
            ...current.current,
            x: current.current.x + next.middle.x - previous.middle.x,
            y: current.current.y + next.middle.y - previous.middle.y,
          },
          scale,
          { x: next.middle.x - rect.left - rect.width / 2, y: next.middle.y - rect.top - rect.height / 2 },
          bounds.current,
        ),
      );
      suppressClick.current = true;
    } else if (dragged || suppressClick.current) {
      suppressClick.current = true;
      move({ ...current.current, x: current.current.x + dx, y: current.current.y + dy });
      if (allowTilt) {
        inclination.current = dragTilt(inclination.current, dx, dy);
        setAngle(inclination.current);
      }
    }
    if (suppressClick.current) {
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }
  function release(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    if (!pointers.current.size) setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <div
      ref={viewport}
      className="board-viewport"
      data-depth={depth}
      data-dragging={dragging}
      tabIndex={0}
      aria-label={`Board. Scroll or pinch to zoom; drag to pan${allowTilt ? ' and gently tilt' : ''}; zero fits the view.`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onClickCapture={(e) => {
        if (suppressClick.current && !(e.target as Element).closest('button')) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (['+', '=', '-', '0'].includes(e.key)) {
          e.preventDefault();
          if (e.key === '0') reset();
          else
            move(
              zoomAt(
                current.current,
                current.current.scale + (e.key === '-' ? -0.1 : 0.1),
                { x: 0, y: 0 },
                bounds.current,
              ),
            );
        }
      }}
    >
      <div
        className="board-camera"
        style={{
          width: Math.min(bounds.current.width, (bounds.current.height * 880) / 804),
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})${depth ? ` rotateX(${angle.pitch}deg) rotateY(${angle.yaw}deg)` : ''}`,
        }}
      >
        {children}
      </div>
      <button
        className="board-fit-view"
        aria-label="Fit board view"
        title="Fit view · Scroll or pinch to zoom · 0 to reset"
        onClick={reset}
      >
        <Focus size={17} />
      </button>
    </div>
  );
}
