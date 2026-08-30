import { ImageResponse } from "next/og";

// Required for the generated image route under `output: export`.
export const dynamic = "force-static";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * iOS home-screen icon. iOS ignores SVG here, so the mark is rasterized at build time
 * from the same geometry as `icon.svg` — one drawing, two formats.
 */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b1220",
      }}
    >
      <svg
        width="132"
        height="132"
        viewBox="0 0 48 48"
        role="img"
        aria-label="Integra LCP Packages"
      >
        <rect x="3" y="3" width="42" height="42" rx="9" fill="#2563d9" />
        <path
          d="M 3 24 h 12 M 33 24 h 12"
          fill="none"
          stroke="#ffffff"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        <circle cx="24" cy="24" r="8" fill="#ffffff" />
      </svg>
    </div>,
    size,
  );
}
