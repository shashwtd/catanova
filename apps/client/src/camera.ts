import { WORLD } from './scene.js';
export type Camera = { scale: number; x: number; y: number };
export type Bounds = { width: number; height: number };
export const MIN_ZOOM = 0.85,
  MAX_ZOOM = 2.2;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function fitBoard(bounds: Bounds): Bounds {
  const width = Math.min(
    Math.max(1, bounds.width - 24),
    (Math.max(1, bounds.height - 24) * WORLD.width) / WORLD.height,
  );
  return { width, height: (width * WORLD.height) / WORLD.width };
}
export function constrainCamera(camera: Camera, bounds: Bounds): Camera {
  const scale = clamp(camera.scale, MIN_ZOOM, MAX_ZOOM);
  const board = fitBoard(bounds);
  const maxX = Math.max(0, (board.width * scale - bounds.width) / 2) + Math.min(90, bounds.width * 0.18);
  const maxY = Math.max(0, (board.height * scale - bounds.height) / 2) + Math.min(80, bounds.height * 0.18);
  return { scale, x: clamp(camera.x, -maxX, maxX) || 0, y: clamp(camera.y, -maxY, maxY) || 0 };
}
export function zoomAt(
  camera: Camera,
  scale: number,
  focal: { x: number; y: number },
  bounds: Bounds,
): Camera {
  const next = clamp(scale, MIN_ZOOM, MAX_ZOOM),
    ratio = next / camera.scale;
  return constrainCamera(
    { scale: next, x: focal.x - (focal.x - camera.x) * ratio, y: focal.y - (focal.y - camera.y) * ratio },
    bounds,
  );
}
export const wheelScale = (scale: number, delta: number) => scale * Math.exp(-clamp(delta, -24, 24) * 0.0009);
export const pinchScale = (scale: number, distance: number, previous: number) =>
  scale * clamp(Math.pow(Math.max(20, distance) / Math.max(20, previous), 0.4), 0.965, 1.035);
