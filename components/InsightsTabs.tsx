"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Insights is one place in the sidebar with two views: how the portfolio
// is doing (Impact) and the numbers across it (Statistics).
export default function InsightsTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/impact", label: "Portfolio health" },
    { href: "/statistics", label: "Statistics" },
  ];
  return (
    <nav className="seg insights-tabs" aria-label="Insights views">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={pathname === t.href ? "is-on" : ""} aria-current={pathname === t.href ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
