import { routeStations, STAGE_LABELS } from "@/lib/billStage";
import { formatDate } from "@/lib/billMeta";

// The app's signature element: a bill's path through Congress drawn as a
// transit line. Stations follow the bill's own chamber order, so a Senate
// bill reads Senate -> House. Used small in bill lists and large on the
// bill page (where each station can carry the date it was reached).
//
// Color carries meaning, consistently everywhere: the completed part of the
// line takes the color of the stage the bill has reached (amber = in
// committee, blue = through a chamber, violet = at the President, mint = law,
// red = stopped).
export default function RouteLine({
  stage,
  billType,
  size = "sm",
  dates,
  animate = false,
}: {
  stage: string;
  billType: string;
  size?: "sm" | "lg";
  /** Optional date per station index (large size only). */
  dates?: (string | null | undefined)[];
  animate?: boolean;
}) {
  const stations = routeStations(stage, billType);
  const reached = stations.reduce((n, s, i) => (s.state !== "todo" ? i : n), 0);
  const pct = stations.length > 1 ? (reached / (stations.length - 1)) * 100 : 0;
  const label = `${STAGE_LABELS[stage] ?? stage}: station ${reached + 1} of ${stations.length}`;

  return (
    <div className={`route route-${size} route-tone-${toneFor(stage)}${animate ? " route-animate" : ""}`} role="img" aria-label={label}>
      <div className="route-rail" aria-hidden="true">
        <div className="route-rail-fill" style={{ width: `${pct}%` }} />
      </div>
      <ol className="route-stations" aria-hidden="true">
        {stations.map((s, i) => (
          <li key={s.key} className={`route-station route-${s.state}`} style={{ left: `${stations.length > 1 ? (i / (stations.length - 1)) * 100 : 0}%` }}>
            <span className="route-dot" />
            {size === "lg" && (
              <span className="route-label">
                <span className="route-label-name">{s.label}</span>
                {dates?.[i] && <span className="route-label-date">{formatDate(dates[i])}</span>}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function toneFor(stage: string): "idle" | "committee" | "chamber" | "president" | "law" | "stopped" {
  switch (stage) {
    case "committee":
    case "reported":
      return "committee";
    case "passed_house":
    case "passed_senate":
    case "passed_both":
      return "chamber";
    case "to_president":
      return "president";
    case "enacted":
    case "agreed":
      return "law";
    case "vetoed":
    case "failed":
      return "stopped";
    default:
      return "idle";
  }
}

export function StagePill({ stage }: { stage: string }) {
  return <span className={`stage-pill tone-${toneFor(stage)}`}>{STAGE_LABELS[stage] ?? stage}</span>;
}
