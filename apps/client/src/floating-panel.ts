export type PanelRect = { left: number; top: number; width: number; height: number };
export type PanelPlacement = 'above' | 'beside';
export type PanelAlignment = 'top' | 'bottom' | 'auto';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** Resolve size before measuring content, so a tall card never briefly flips below its trigger. */
export function placeGamePanel(
  anchor: PanelRect,
  panel: Pick<PanelRect, 'width' | 'height'>,
  viewport: PanelRect,
  placement: PanelPlacement,
  alignment: PanelAlignment = 'auto',
) {
  const margin = 12,
    gap = 12;
  const leftEdge = viewport.left + margin,
    topEdge = viewport.top + margin;
  const rightEdge = viewport.left + viewport.width - margin;
  const bottomEdge = viewport.top + viewport.height - margin;
  const availableWidth = Math.max(0, viewport.width - margin * 2);
  const availableHeight = Math.max(0, viewport.height - margin * 2);
  const centerY = clamp(anchor.top + anchor.height / 2, topEdge, bottomEdge);
  const besideLeft = Math.max(leftEdge, anchor.left + anchor.width + gap);
  const besideSpace = rightEdge - besideLeft;
  const beside = placement === 'beside' && besideSpace >= Math.min(220, availableWidth);
  const bottomAligned =
    alignment === 'bottom' || (alignment === 'auto' && centerY > viewport.top + viewport.height / 2);
  const alignedEdge = clamp(bottomAligned ? anchor.top + anchor.height : anchor.top, topEdge, bottomEdge);
  const aboveSpace = Math.max(0, Math.min(bottomEdge, anchor.top - gap) - topEdge);
  const belowSpace = Math.max(0, bottomEdge - Math.max(topEdge, anchor.top + anchor.height + gap));
  const above = aboveSpace >= Math.min(120, availableHeight / 2) || aboveSpace >= belowSpace;
  const width = Math.min(panel.width, beside ? besideSpace : availableWidth);
  // Content scrolls towards the available space; it never grows past the anchored button edge.
  const maxHeight = beside
    ? bottomAligned
      ? alignedEdge - topEdge
      : bottomEdge - alignedEdge
    : Math.max(0, above ? aboveSpace : belowSpace);
  const height = Math.min(panel.height, maxHeight);
  const left = beside ? besideLeft : clamp(anchor.left, leftEdge, rightEdge - width);
  const top = beside
    ? bottomAligned
      ? alignedEdge - height
      : alignedEdge
    : above
      ? clamp(anchor.top - gap - height, topEdge, bottomEdge - height)
      : clamp(anchor.top + anchor.height + gap, topEdge, bottomEdge - height);
  const notchSide = beside ? 'left' : above ? 'bottom' : 'top';
  const notch = beside
    ? clamp(centerY - top, 16, height - 16)
    : clamp(anchor.left + anchor.width / 2 - left, 16, width - 16);
  return { left, top, width, maxHeight, notchSide, notch, bottomAligned: beside ? bottomAligned : above };
}

export function fitFloatingPanel(
  anchor: PanelRect,
  panel: Pick<PanelRect, 'width' | 'height'>,
  viewport: PanelRect,
) {
  const { left, top, width, maxHeight } = placeGamePanel(anchor, panel, viewport, 'above');
  return { left, top, width, maxHeight };
}
