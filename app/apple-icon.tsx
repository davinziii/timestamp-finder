import { ImageResponse } from "next/og";

// Home-screen icon for iOS. Full-bleed: iOS applies its own rounded mask.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#e5352b",
        }}
      >
        <svg width="96" height="96" viewBox="0 0 16 16">
          <path d="M4.5 2.5v11L13 8 4.5 2.5Z" fill="#ffffff" />
        </svg>
      </div>
    ),
    size,
  );
}
