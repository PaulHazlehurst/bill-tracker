"use client";

import { useState } from "react";

// Truncates long text to a character limit with a "Read more" toggle -
// used anywhere CRS summaries or other official text can run long (some
// bill summaries are several paragraphs). Short text renders as plain text
// with no button at all, so this never adds clutter to something already
// short enough to read at a glance.
export default function ExpandableText({ text, limit = 420, className, style }: {
  text: string;
  limit?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > limit;
  const display = !needsTruncation || expanded ? text : text.slice(0, limit).trimEnd() + "…";

  return (
    <p className={className} style={style}>
      {display}
      {needsTruncation && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="expandable-text-toggle"
        >
          {expanded ? " Show less" : " Read more"}
        </button>
      )}
    </p>
  );
}
