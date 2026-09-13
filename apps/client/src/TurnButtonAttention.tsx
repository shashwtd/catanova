/** A quiet rim and two small highlights frame the action without covering its artwork. */
export function TurnButtonAttention() {
  return (
    <svg
      className="turn-button-attention"
      viewBox="0 0 80 74"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="turn-rim" x="2" y="2" width="76" height="70" rx="12" />
      <path className="turn-corner" d="M3 20v-6A11 11 0 0 1 14 3h9 M57 71h9a11 11 0 0 0 11-11v-6" />
    </svg>
  );
}
