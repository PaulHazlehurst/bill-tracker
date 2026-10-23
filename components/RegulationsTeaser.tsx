"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Scale, ArrowRight } from "lucide-react";

// One quiet line under Discover: how many federal regulations currently
// match your topics. Count-only, RLS-scoped.
export default function RegulationsTeaser() {
  const supabase = createClient();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("prospective_regulations")
      .select("id", { count: "exact", head: true })
      .eq("dismissed", false)
      .then(({ count }) => setCount(count ?? 0), () => setCount(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!count) return null;
  return (
    <Link href="/regulations" className="teaser">
      <span className="teaser-icon"><Scale size={16} /></span>
      <span className="teaser-text"><strong>{count}</strong> federal regulation{count === 1 ? "" : "s"} match your topics</span>
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}
