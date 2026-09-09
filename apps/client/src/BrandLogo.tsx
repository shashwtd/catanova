/** Display the selected original PNGs without changing their embedded artwork or provenance. */
export function BrandLogo({ mark = false, className = '' }: { mark?: boolean; className?: string }) {
  return (
    <svg
      className={`landing-logo ${className}`}
      viewBox={mark ? '145 105 983 1113' : '40 55 2115 640'}
      role="img"
      aria-label="Catanova"
      preserveAspectRatio="xMidYMid meet"
    >
      <image
        href={mark ? '/art/branding/catanova-mark-v2.png' : '/art/branding/catanova-logo-v2.png'}
        width={mark ? 1254 : 2172}
        height={mark ? 1254 : 724}
      />
    </svg>
  );
}
