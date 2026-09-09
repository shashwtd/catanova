export type Camera = { scale: number; x: number; y: number };
export type Bounds = { width: number; height: number };
export const MIN_ZOOM = 0.85,
  MAX_ZOOM = 2.2;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function constrainCamera(camera: Camera, bounds: Bounds): Camera {
  const scale = clamp(camera.scale, MIN_ZOOM, MAX_ZOOM);
  const boardWidth = Math.min(bounds.width, (bounds.height * 880) / 804),
    boardHeight = (boardWidth * 804) / 880;
  const maxX = Math.max(0, (boardWidth * scale - bounds.width) / 2) + (scale > 1 ? 25 : 0);
  const maxY = Math.max(0, (boardHeight * scale - bounds.height) / 2) + (scale > 1 ? 25 : 0);
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
export const wheelScale = (scale: number, delta: number) => scale * Math.exp(-clamp(delta, -40, 40) * 0.0018);
export const pinchScale = (scale: number, distance: number, previous: number) =>
  scale * clamp(Math.pow(Math.max(20, distance) / Math.max(20, previous), 0.65), 0.93, 1.07);
