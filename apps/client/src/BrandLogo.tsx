/** Display optimized artwork with the original canvas and composition. */
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
        href={
          mark
            ? '/art/optimized/catanova-mark-v2.77f0ea5ff580.webp'
            : '/art/optimized/catanova-logo-v2.a161a887edbc.webp'
        }
        width={mark ? 1254 : 2172}
        height={mark ? 1254 : 724}
      />
    </svg>
  );
}
