/** One inexpensive SVG stroke follows the button edge; it never covers the dice artwork. */
export function TurnButtonAttention() {
  return (
    <svg
      className="turn-button-attention"
      viewBox="0 0 80 74"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="74" height="68" rx="12" pathLength="100" />
    </svg>
  );
}
