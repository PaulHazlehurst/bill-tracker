"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Scale, ArrowRight } from "lucide-react";

// A quiet one-line strip on the dashboard that says "N federal regulations
// match your topics → Regulations". Sits below the bill-suggestions strip
// so the dashboard shows both channels of what discovery has found without
// growing another full section.
//
// Reads the same prospective_regulations table the /regulations page uses,
// RLS-scoped, count-only.
export default function RegulationsTeaser() {
  const supabase = createClient();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { count } = await supabase
        .from("prospective_regulations")
        .select("id", { count: "exact", head: true })
        .eq("dismissed", false);
      setCount(count ?? 0);
    })().catch(() => setCount(0));
  }, []);

  if (count === null || count === 0) return null;

  return (
    <Link
      href="/regulations"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        margin: "10px 0 0",
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--surface)",
        textDecoration: "none",
        color: "var(--text)",
        transition: "border-color 0.15s ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 8,
          background: "color-mix(in srgb, var(--accent) 18%, var(--surface))",
          color: "var(--accent)",
          flexShrink: 0,
        }}
      >
        <Scale size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontFamily: "var(--font-display), sans-serif" }}>{count}</strong>{" "}
        federal {count === 1 ? "regulation" : "regulations"} match{count === 1 ? "es" : ""} your topics
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.78rem", color: "var(--accent)", fontWeight: 600 }}>
        Open <ArrowRight size={13} />
      </span>
    </Link>
  );
}
