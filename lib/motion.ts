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

/**
 * For Undo: puts back just the items with the given ids, in the places they
 * had in `before`, without disturbing anything else that changed since
 * (another item dismissed in the meantime stays dismissed).
 */
export function restoreItems<T extends { id: string }>(current: T[], before: T[], ids: Iterable<string>): T[] {
  const back = new Set(ids);
  const now = new Set(current.map((x) => x.id));
  const known = new Set(before.map((x) => x.id));
  const byId = new Map(current.map((x) => [x.id, x]));
  const restored = before.filter((x) => now.has(x.id) || back.has(x.id)).map((x) => byId.get(x.id) ?? x);
  return [...restored, ...current.filter((x) => !known.has(x.id))];
}
