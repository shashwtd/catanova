import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, PointerEvent } from 'react';
import type { Board } from '../../../packages/rules/src/board.js';
import { useGameInteractionGuards } from './useGameInteractionGuards.js';
import { BoardGesture, constrainCamera, fitBoard, openingCamera, wheelScale, zoomAt } from './camera.js';
import type { Bounds, Camera } from './camera.js';
import { boardKey, hasSea, islandsBox, MATERIAL_GUTTER, MATERIAL_QUADRANTS, worldBox } from './scene.js';

/** How wide each mirrored quarter of the painted water is, in board units: the board's own `ocean-material`. */
const OCEAN_QUADRANT = 240;

export function BoardViewport({
  board,
  children,
  reducedMotion = false,
  ocean,
}: {
  /** The board being framed: the camera fits its world box, and starts over when a new board is dealt. */
  board: Board;
  children: ReactNode;
  reducedMotion?: boolean;
  /**
   * A board with sea is played on open water, not on the table: the painted texture its water is drawn from (the
   * board theme's environment), carried out to the edges of the screen as deep sea.
   */
  ocean?: string;
}) {
  useGameInteractionGuards();
  const key = boardKey(board),
    box = useMemo(() => worldBox(board), [key]),
    islands = useMemo(() => islandsBox(board), [key]);
  const viewport = useRef<HTMLDivElement>(null),
    current = useRef<Camera>({ scale: 1, x: 0, y: 0 }),
    target = useRef(current.current),
    bounds = useRef<Bounds>({ width: 1, height: 1 }),
    origin = useRef({ x: 0, y: 0 }),
    frame = useRef<number | null>(null),
    quiet = useRef(reducedMotion),
    // A ref, like `quiet`, because the wheel handler outlives the render that registered it.
    world = useRef(box),
    opening = useRef(() => openingCamera(bounds.current, box, islands)),
    // Until the player moves the camera, it keeps to the opening view as the screen changes size.
    untouched = useRef(true);
  quiet.current = reducedMotion;
  world.current = box;
  opening.current = () => openingCamera(bounds.current, box, islands);
  const patternId = `table-${useId().replaceAll(':', '')}`;
  const openSea = useMemo(() => hasSea(board), [key]);
  const [camera, setCamera] = useState(current.current),
    [dragging, setDragging] = useState(false);
  const gesture = useRef(new BoardGesture());
  function move(next: Camera) {
    current.current = constrainCamera(next, bounds.current, world.current);
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
    target.current = constrainCamera(next, bounds.current, world.current);
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
    untouched.current = true;
    move(opening.current());
    target.current = current.current;
  }, [key]);
  // Once a zoom settles, the terrain draws itself again at the size now shown (Terrain.tsx), so it stays sharp.
  useEffect(() => {
    const timer = window.setTimeout(() => viewport.current?.dispatchEvent(new Event('boardzoom')), 200);
    return () => window.clearTimeout(timer);
  }, [camera.scale]);
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
      move(untouched.current ? opening.current() : current.current);
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
      untouched.current = false;
      glide(
        zoomAt(
          target.current,
          wheelScale(target.current.scale, delta),
          { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 },
          bounds.current,
          world.current,
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
    const next = gesture.current.update(
      event.pointerId,
      point(event),
      current.current,
      bounds.current,
      world.current,
    );
    if (next) {
      untouched.current = false;
      move(next);
    }
    target.current = current.current;
    captureGesture(event);
  }
  function release(event: PointerEvent<HTMLDivElement>) {
    gesture.current.end(event.pointerId, current.current);
    setDragging(gesture.current.dragging);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const fitted = fitBoard(bounds.current, world.current);
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
        untouched.current = event.key === '0';
        if (event.key === '0') glide(opening.current());
        else
          glide(
            zoomAt(
              target.current,
              target.current.scale + (event.key === '-' ? -0.07 : 0.07),
              { x: 0, y: 0 },
              bounds.current,
              world.current,
            ),
          );
      }}
    >
      {openSea ? (
        <Surface
          id={patternId}
          texture={ocean ?? '/art/optimized/environment-painted.00c506c983c0.webp'}
          // The board's own water, at the board's scale: one board unit is the fitted size over the world's.
          quadrant={OCEAN_QUADRANT * (fitted.width / world.current.width)}
          cell={{ x: 0, y: 0 }}
          overlay="open-water-depth"
          x={origin.current.x + camera.x}
          y={origin.current.y + camera.y}
          scale={camera.scale}
        />
      ) : (
        <Surface
          id={patternId}
          texture="/art/optimized/environment-dark.c55c6de597e4.webp"
          quadrant={360}
          cell={{ x: 1, y: 1 }}
          overlay="table-tint"
          x={origin.current.x + camera.x}
          y={origin.current.y + camera.y}
          scale={camera.scale}
        />
      )}
      {/* Lit rather than washed: see `table-light.css`. Both sit under the
          board and neither is inside the camera, so panning repaints nothing. */}
      <div className="table-light" aria-hidden="true" />
      <div className="table-vignette" aria-hidden="true" />
      <div
        className="board-camera"
        style={{
          width: fitted.width,
          height: fitted.height,
          aspectRatio: `${world.current.width}/${world.current.height}`,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * What the board lies on, the table or, for a board with sea, the open sea: one mirrored tile of a painted texture,
 * repeated. It is drawn once, on a plane a little larger than the window, and the camera only moves and scales
 * that plane, so panning and zooming repaint nothing: redrawing a pattern across the whole window on every frame
 * was nearly all the work a pan or zoom cost. The plane moves by whole tiles, so it always covers the window.
 */
function Surface({
  id,
  texture,
  quadrant,
  cell,
  overlay,
  x,
  y,
  scale,
}: {
  id: string;
  texture: string;
  /** How wide each mirrored quarter of the tile is, in pixels at the camera's scale 1. */
  quadrant: number;
  /** Which 512-pixel cell of the texture the tile is cut from. */
  cell: { x: number; y: number };
  /** The class of the tint laid over it. */
  overlay: string;
  x: number;
  y: number;
  scale: number;
}) {
  const period = quadrant * 2,
    step = period * scale;
  // Sized for the scale rounded down to a step of a half octave, so zooming resizes the plane only now and then.
  const sizing = 2 ** (Math.floor(Math.log2(Math.max(scale, 0.05)) * 2) / 2);
  const width = Math.ceil((typeof window === 'undefined' ? 1920 : window.innerWidth) / sizing + period * 2),
    height = Math.ceil((typeof window === 'undefined' ? 1080 : window.innerHeight) / sizing + period * 2);
  const left = (((x % step) + step) % step) - step,
    top = (((y % step) + step) % step) - step;
  return (
    <div className="board-world-surface" aria-hidden="true">
      <svg
        className="board-world-plane"
        width={width}
        height={height}
        style={{ transform: `translate(${left}px, ${top}px) scale(${scale})` }}
      >
        <defs>
          <pattern id={id} width={period} height={period} patternUnits="userSpaceOnUse">
            {MATERIAL_QUADRANTS.map(({ x: qx, y: qy, sx, sy }, index) => (
              <g key={index} transform={`translate(${qx * quadrant} ${qy * quadrant}) scale(${sx} ${sy})`}>
                <svg
                  width={quadrant}
                  height={quadrant}
                  viewBox={`${cell.x * 512 + MATERIAL_GUTTER} ${cell.y * 512 + MATERIAL_GUTTER} ${512 - MATERIAL_GUTTER * 2} ${512 - MATERIAL_GUTTER * 2}`}
                >
                  <image href={texture} width="1024" height="1024" />
                </svg>
              </g>
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
        <rect className={overlay} width="100%" height="100%" />
      </svg>
    </div>
  );
}
