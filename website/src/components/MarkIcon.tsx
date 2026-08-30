/**
 * The site mark: two rails meeting at one node.
 *
 * The whole of LCP is one join. The terms document is hashed to an ATR hash; that hash is
 * carried in a field the settlement itself commits to. Two systems that were joined by nothing
 * durable now meet at a single point that either matches or does not. So the mark is a line
 * running edge to edge with one node on it, rather than a posture or a monogram.
 *
 * The frame, the stroke weight and the edge-to-edge rule are shared with the mark on the
 * agentic-terms site on purpose: the two documentation sites are one family, and a reader who
 * knows one should recognize the other. What differs is the mechanism each one draws.
 *
 * Inline SVG on `currentColor` rather than a pair of theme-swapped image files — the mark has
 * one colour, so a second asset would only be a second thing to keep in sync with the palette.
 * `icon.svg` and `apple-icon.tsx` carry the same geometry filled, because a stroked mark
 * disappears at favicon size.
 */
export function MarkIcon({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="Integra LCP Packages"
      className={className}
    >
      <rect
        x="6"
        y="6"
        width="36"
        height="36"
        rx="7"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        d="M 6 24 h 11 M 31 24 h 11"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="6" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}
