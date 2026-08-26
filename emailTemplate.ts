"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import TopicsHero from "@/components/TopicsHero";
import ProspectiveBills from "@/components/ProspectiveBills";

// Split out of the dashboard: "what am I already tracking" and "what
// might I be missing" are different jobs, and burying the second one
// under the first undersold the actual point of topic-based discovery -
// getting ahead of bills nobody on the team knew to search for.
export default function DiscoveryPage() {
  // Bumping this remounts ProspectiveBills, which re-fetches its list -
  // the simplest way to refresh it after a topic edit or a manual
  // "Check now" finds something new, without threading fetch logic
  // between two independent components.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Get ahead of it</span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Discovery</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Bills matching your topics that nobody's tracking yet - checked automatically every day.
          </p>
        </div>
      </div>

      <TopicsHero onDiscovered={() => setRefreshKey((k) => k + 1)} />
      <div style={{ marginTop: 20 }}>
        <ProspectiveBills key={refreshKey} onTracked={() => setRefreshKey((k) => k + 1)} />
      </div>
    </div>
  );
}
