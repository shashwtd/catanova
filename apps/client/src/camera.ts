import { WORLD } from './scene.js';
export type Camera = { scale: number; x: number; y: number };
export type Bounds = { width: number; height: number };
export type Point = { x: number; y: number };
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
  const scale = clamp(camera.scale, MIN_ZOOM, maxZoom(bounds));
  const board = fitBoard(bounds);
  const maxX = Math.max(0, (board.width * scale - bounds.width) / 2) + Math.min(90, bounds.width * 0.18);
  const maxY = Math.max(0, (board.height * scale - bounds.height) / 2) + Math.min(80, bounds.height * 0.18);
  return { scale, x: clamp(camera.x, -maxX, maxX) || 0, y: clamp(camera.y, -maxY, maxY) || 0 };
}
/** A small fitted board needs more magnification to make its roads selectable. */
export const maxZoom = (bounds: Bounds) => Math.max(MAX_ZOOM, Math.min(4, 960 / fitBoard(bounds).width));
export function zoomAt(
  camera: Camera,
  scale: number,
  focal: { x: number; y: number },
  bounds: Bounds,
): Camera {
  const next = clamp(scale, MIN_ZOOM, maxZoom(bounds)),
    ratio = next / camera.scale;
  return constrainCamera(
    { scale: next, x: focal.x - (focal.x - camera.x) * ratio, y: focal.y - (focal.y - camera.y) * ratio },
    bounds,
  );
}
export const wheelScale = (scale: number, delta: number) => scale * Math.exp(-clamp(delta, -24, 24) * 0.0009);
export const pinchScale = (scale: number, distance: number, previous: number) =>
  scale * (Math.max(16, distance) / Math.max(16, previous));

type Contact = Point & { start: Point };
type Pinch = { ids: [number, number]; distance: number; middle: Point; camera: Camera };
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Pointer coordinates are relative to the measured viewport center, in CSS pixels. */
export class BoardGesture {
  private contacts = new Map<number, Contact>();
  private pinch: Pinch | null = null;
  private blocked = false;
  dragging = false;
  get pointerIds() {
    return [...this.contacts.keys()];
  }
  has(id: number) {
    return this.contacts.has(id);
  }
  blocksClick(detail: number) {
    // Keyboard and assistive-technology activation must survive a cancelled touch gesture.
    return detail > 0 && this.blocked;
  }
  start(id: number, point: Point, camera: Camera) {
    if (!this.contacts.size) this.blocked = this.dragging = false;
    this.contacts.set(id, { ...point, start: point });
    if (this.contacts.size > 1) this.blocked = this.dragging = true;
    this.rebase(camera);
  }
  private rebase(camera: Camera) {
    const [a, b] = [...this.contacts.entries()];
    this.pinch =
      a && b
        ? { ids: [a[0], b[0]], distance: distance(a[1], b[1]), middle: midpoint(a[1], b[1]), camera }
        : null;
    for (const contact of this.contacts.values()) contact.start = { x: contact.x, y: contact.y };
  }
  update(id: number, point: Point, camera: Camera, bounds: Bounds): Camera | null {
    const previous = this.contacts.get(id);
    if (!previous) return null;
    this.contacts.set(id, { ...point, start: previous.start });
    if (this.pinch) {
      const base = this.pinch;
      if (!base.ids.includes(id)) return null;
      const a = this.contacts.get(base.ids[0])!,
        b = this.contacts.get(base.ids[1])!;
      const middle = midpoint(a, b),
        separation = distance(a, b);
      // Coincident fingers do not define a usable scale. Start a fresh baseline once apart.
      if (base.distance < 16) {
        this.rebase(camera);
        return null;
      }
      const requested = pinchScale(base.camera.scale, separation, base.distance);
      const scale = clamp(requested, MIN_ZOOM, maxZoom(bounds)),
        ratio = scale / base.camera.scale;
      const desired = {
        scale,
        x: middle.x - (base.middle.x - base.camera.x) * ratio,
        y: middle.y - (base.middle.y - base.camera.y) * ratio,
      };
      const next = constrainCamera(desired, bounds);
      // At a limit, rebase so reversing the fingers responds immediately instead of unwinding overshoot.
      if (scale !== requested || next.x !== desired.x || next.y !== desired.y) this.rebase(next);
      return next;
    }
    if (!this.dragging && distance(previous.start, point) <= 6) return null;
    const from = this.dragging ? previous : previous.start;
    this.blocked = this.dragging = true;
    return constrainCamera(
      { ...camera, x: camera.x + point.x - from.x, y: camera.y + point.y - from.y },
      bounds,
    );
  }
  end(id: number, camera: Camera) {
    if (!this.contacts.delete(id)) return;
    this.rebase(camera);
    if (!this.contacts.size) this.dragging = false;
  }
  captureLost(id: number, camera: Camera, capture: { fromViewport: boolean; stillCaptured: boolean }) {
    // A child's implicit touch capture is lost when this viewport takes over.
    // Only loss of our own capture can retire an active contact.
    if (!capture.fromViewport || capture.stillCaptured) return false;
    this.end(id, camera);
    return true;
  }
  cancel() {
    if (this.contacts.size) this.blocked = true;
    this.contacts.clear();
    this.pinch = null;
    this.dragging = false;
  }
}
