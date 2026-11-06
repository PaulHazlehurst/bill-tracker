import type { MetadataRoute } from "next";

// Lets people install Bill Tracker like an app (Add to Home Screen on a
// phone, Install on a computer). On iPhone and iPad this is required for
// push alerts: Apple only allows them for sites added to the Home Screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bill Tracker",
    short_name: "Bill Tracker",
    description: "Follow federal bills, state drug boards and regulations, and get alerted when they move.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6fa",
    theme_color: "#0e1530",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
