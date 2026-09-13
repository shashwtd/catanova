type Rect = { left: number; top: number; width: number; height: number };

/** Keep the complete panel reachable, including on a zoomed or keyboard-reduced viewport. */
export function fitFloatingPanel(anchor: Rect, panel: Pick<Rect, 'width' | 'height'>, viewport: Rect) {
  const margin = 12;
  const leftEdge = viewport.left + margin;
  const topEdge = viewport.top + margin;
  const width = Math.min(panel.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(panel.height, Math.max(0, viewport.height - margin * 2));
  const left = Math.max(leftEdge, Math.min(anchor.left, viewport.left + viewport.width - width - margin));
  const above = anchor.top - height - margin;
  const below = anchor.top + anchor.height + margin;
  const top = above >= topEdge ? above : Math.min(below, viewport.top + viewport.height - height - margin);
  return { left, top: Math.max(topEdge, top), width, maxHeight: Math.max(0, viewport.height - margin * 2) };
}
