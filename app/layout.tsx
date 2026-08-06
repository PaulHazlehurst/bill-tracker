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
      <body>{children}</body>
    </html>
  );
}
