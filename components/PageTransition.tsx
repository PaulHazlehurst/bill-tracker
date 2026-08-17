"use client";

import { usePathname } from "next/navigation";

// A lightweight, dependency-free page transition. React remounts the inner
// div whenever `key` changes - keying it to the pathname means every route
// change naturally retriggers the CSS entrance animation below, with no
// animation library and no risk of fighting Next.js's own navigation.
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-transition">
      {children}
    </div>
  );
}
