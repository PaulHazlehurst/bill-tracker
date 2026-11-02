"use client";

import { ViewTransition } from "react";
import { usePathname } from "next/navigation";

// Page changes: the old page fades out quickly and the new one settles in
// from just below, using the browser's View Transitions. The rail and top
// bar sit outside this boundary, so they stay put as a fixed reference
// while only the content moves. Keyed to the pathname so each route change
// counts as one page leaving and another arriving.
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="page-in" exit="page-out" default="none">
      <div className="page-frame">{children}</div>
    </ViewTransition>
  );
}
