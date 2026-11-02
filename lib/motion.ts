// Motion helpers. The app animates with the browser's own View Transitions
// (through React's <ViewTransition>), so there's no animation library and
// nothing extra to download. Browsers without support simply update
// instantly, and people who ask their system for less motion get none
// (see the reduced-motion rules in app/styles/motion.css).

import { startTransition } from "react";

/**
 * Runs a state change as a React transition, so list items wrapped in
 * <MotionItem> animate out (or in) and the items around them glide into
 * their new places instead of jumping.
 */
export function animated(update: () => void) {
  startTransition(update);
}

/**
 * The pattern behind every instant-feeling action: change the screen now,
 * save in the background, and put things back (with a message) if the save
 * fails. Returns whether the save worked.
 */
export async function optimistic({
  apply,
  revert,
  save,
  onError,
}: {
  apply: () => void;
  revert: () => void;
  save: () => Promise<Response | boolean | null | undefined>;
  onError?: () => void;
}): Promise<boolean> {
  animated(apply);
  let ok = false;
  try {
    const r = await save();
    ok = typeof r === "boolean" ? r : !!r && r.ok;
  } catch {
    ok = false;
  }
  if (!ok) {
    animated(revert);
    onError?.();
  }
  return ok;
}
