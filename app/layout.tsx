import "./globals.css";
import "./styles/shell.css";
import "./styles/bills.css";
import "./styles/pages.css";
import "./styles/features.css";
import "./styles/motion.css";
import localFont from "next/font/local";

// Fonts are served from this app (app/fonts) rather than Google Fonts: one
// less website to wait on before text shows, and a size-matched stand-in
// while they load so the page doesn't shift. The CSS picks them up through
// these variables (see --font-display, --font-ui and --font-mono in globals.css).
const display = localFont({
  src: "./fonts/bricolage-grotesque-latin-standard-normal.woff2",
  variable: "--font-bricolage",
  weight: "200 800",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "75% 100%" }],
});
const ui = localFont({
  src: "./fonts/instrument-sans-latin-standard-normal.woff2",
  variable: "--font-instrument",
  weight: "400 700",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "75% 100%" }],
});
const mono = localFont({
  src: "./fonts/geist-mono-latin-wght-normal.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  preload: false,
});

// Every page depends on a signed-in session that only exists at request
// time, so nothing is pre-built as static HTML.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bill Tracker",
  description: "Follow federal bills through Congress, see what changed overnight, and get alerted when they move.",
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f22" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <head>
        {/* Runs before paint so the saved theme, text size, and density apply
            immediately instead of flashing the defaults. With no saved
            theme, the operating system's light/dark setting is used. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
              var t = localStorage.getItem("billtracker-theme");
              if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
              else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.setAttribute("data-theme", "dark");
              var f = localStorage.getItem("billtracker-font-size");
              if (f) document.documentElement.setAttribute("data-font-size", f);
              var d = localStorage.getItem("billtracker-density");
              if (d && d !== "comfortable") document.documentElement.setAttribute("data-density", d);
            } catch (e) {}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
