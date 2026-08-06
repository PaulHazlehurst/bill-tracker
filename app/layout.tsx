import "./globals.css";

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
