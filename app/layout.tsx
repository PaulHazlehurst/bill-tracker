import "./globals.css";
import "./styles/shell.css";
import "./styles/bills.css";
import "./styles/pages.css";
import "./styles/features.css";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&family=Instrument+Sans:wdth,wght@75..100,400..700&family=Geist+Mono:wght@400..600&display=swap"
          rel="stylesheet"
        />
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
