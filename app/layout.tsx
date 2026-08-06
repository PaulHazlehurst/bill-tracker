import "./globals.css";

// Every page in this app depends on checking a signed-in user's session,
// which only exists at request time - none of it should be pre-built as
// static HTML. Setting this here, once, at the root layout guarantees it
// applies to every page underneath, so no individual page can accidentally
// skip it.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bill Tracker",
  description: "Track federal bills, get notified when they move.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap"
          rel="stylesheet"
        />
        {/* Runs before paint so the saved theme and font size apply
            immediately - without this, the page would flash the defaults
            for a moment before React hydrates and the settings page's
            controls read localStorage. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
              var t = localStorage.getItem("billtracker-theme");
              if (t) document.documentElement.setAttribute("data-theme", t);
              var f = localStorage.getItem("billtracker-font-size");
              if (f) document.documentElement.setAttribute("data-font-size", f);
            } catch (e) {}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
