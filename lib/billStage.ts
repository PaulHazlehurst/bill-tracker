// The single source of truth for "where is this bill in the process?"
//
// Why this file exists: the app used to work out a bill's stage from ONLY
// the text of its latest action. That's wrong surprisingly often, because
// Congress records plenty of routine actions after a milestone:
//
//   "Passed/agreed to in House: On passage passed…"   -> Passed House  (correct)
//   next day: "Received in the Senate and Read twice and referred to the
//              Committee on Finance."                  -> "In committee" (WRONG -
//                                                         went backwards)
//   "Placed on the Union Calendar, Calendar No. 412."   -> "Introduced"   (WRONG)
//   "Ordered to be Reported by Voice Vote."             -> "Introduced"   (WRONG)
//
// Each of those also fired a bogus "status changed" alert. The fix is to
// derive the stage from the bill's WHOLE action history (one extra
// congress.gov call, only made when something actually changed), and, when
// only a single line of text is available, never let the stage go backwards.
//
// Safe to import from both server and client code - no secrets, no I/O.

export const STAGE_ORDER = [
  "introduced",
  "committee",
  "reported",
  "passed_house",
  "passed_senate",
  "passed_both",
  "to_president",
  "enacted",
] as const;

export const STAGE_LABELS: Record<string, string> = {
  introduced: "Introduced",
  committee: "In committee",
  reported: "Reported by committee",
  passed_house: "Passed House",
  passed_senate: "Passed Senate",
  passed_both: "Passed both chambers",
  to_president: "Sent to President",
  enacted: "Became law",
  agreed: "Agreed to",
  vetoed: "Vetoed",
  failed: "Failed",
};

// Short labels for tight spaces (route-line stations, chips).
export const STAGE_SHORT: Record<string, string> = {
  introduced: "Introduced",
  committee: "Committee",
  reported: "Reported",
  passed_house: "Passed House",
  passed_senate: "Passed Senate",
  passed_both: "Both chambers",
  to_president: "President",
  enacted: "Law",
  agreed: "Agreed to",
  vetoed: "Vetoed",
  failed: "Failed",
};

// Rank is what makes "never go backwards" possible. Terminal outcomes rank
// at the top so a later routine action can't overwrite them.
const RANK: Record<string, number> = {
  introduced: 0,
  committee: 1,
  reported: 2,
  passed_house: 3,
  passed_senate: 3,
  passed_both: 4,
  to_president: 5,
  failed: 6,
  vetoed: 6,
  agreed: 7,
  enacted: 7,
};

export function stageRank(stage: string | null | undefined): number {
  return RANK[stage ?? ""] ?? 0;
}

const PROGRESS: Record<string, number> = {
  introduced: 8,
  committee: 20,
  reported: 36,
  passed_house: 55,
  passed_senate: 55,
  passed_both: 75,
  to_president: 88,
  enacted: 100,
  agreed: 100,
  vetoed: 100,
  failed: 100,
};

export function progressForStage(stage: string): number {
  return PROGRESS[stage] ?? 8;
}

export const TERMINAL_STAGES = new Set(["enacted", "agreed", "vetoed", "failed"]);

// Simple resolutions (one chamber) are finished once that chamber agrees;
// concurrent resolutions once both do. They never go to the President.
const SIMPLE_RES = new Set(["hres", "sres"]);
const CONCURRENT_RES = new Set(["hconres", "sconres"]);

type Milestone = { date: string | null; text: string };

export type Journey = {
  stage: string;
  originChamber: "House" | "Senate";
  introduced: Milestone | null;
  committee: Milestone | null;
  reported: Milestone | null;
  passedHouse: Milestone | null;
  passedSenate: Milestone | null;
  toPresident: Milestone | null;
  law: Milestone | null;
  vetoed: Milestone | null;
  failed: Milestone | null;
};

export type ActionLike = {
  actionDate?: string | null;
  text?: string | null;
  type?: string | null;
  actionCode?: string | null;
};

const RX = {
  law: /became (public|private) law|signed by (the )?president/i,
  veto: /vetoed by (the )?president|pocket veto/i,
  president: /presented to (the )?president/i,
  passedHouse: /passed\/agreed to in house|^passed house|agreed to in (the )?house|resolution agreed to in house/i,
  passedSenate: /passed\/agreed to in senate|^passed senate|agreed to in (the )?senate|resolution agreed to in senate/i,
  failed: /failed of passage|failed passage|not agreed to in (the )?(house|senate)/i,
  reported: /ordered to be reported|reported by (the )?committee|reported \((amended|without amendment|with an amendment)\) by|reported (to|in) (the )?(house|senate)|reported with(out)? amendment|placed on (the )?(union|house|private) calendar|placed on senate legislative calendar|discharged (from|by)/i,
  committee: /referred to|committee|subcommittee|hearings? (held|by)|markup/i,
};

// LOC action codes, when present, are an unambiguous second signal.
const CODE = {
  passedHouse: new Set(["8000"]),
  passedSenate: new Set(["17000"]),
  president: new Set(["28000"]),
  law: new Set(["36000", "41000"]),
  veto: new Set(["31000"]),
  failedHouse: new Set(["9000"]),
  failedSenate: new Set(["18000"]),
  reported: new Set(["5000", "14000"]),
};

export function originChamberFor(billType: string): "House" | "Senate" {
  return billType.toLowerCase().startsWith("s") ? "Senate" : "House";
}

/** Stage from one line of action text. Only a fallback - see stageFromActions. */
export function inferStageFromText(text: string | null | undefined, billType = "hr"): string {
  const t = text ?? "";
  if (RX.law.test(t)) return "enacted";
  if (RX.veto.test(t)) return "vetoed";
  if (RX.president.test(t)) return "to_president";
  if (RX.failed.test(t)) return "failed";
  const house = RX.passedHouse.test(t);
  const senate = RX.passedSenate.test(t);
  const type = billType.toLowerCase();
  if ((house || senate) && SIMPLE_RES.has(type)) return "agreed";
  if (house) return "passed_house";
  if (senate) return "passed_senate";
  if (RX.reported.test(t)) return "reported";
  if (RX.committee.test(t)) return "committee";
  return "introduced";
}

/** Never lets a text-only inference move a bill backwards. */
export function mergeStage(previous: string | null | undefined, next: string): string {
  if (!previous) return next;
  return stageRank(next) >= stageRank(previous) ? next : previous;
}

/**
 * The accurate version: walks the full action history (any order) and
 * records the first date each milestone was reached, then derives the stage
 * from which milestones exist. Chamber-aware: a Senate bill that passes the
 * Senate is "Passed Senate" (its first chamber), and only becomes "Passed
 * both chambers" when the House also passes it.
 */
export function journeyFromActions(actions: ActionLike[], billType: string): Journey {
  const type = billType.toLowerCase();
  const sorted = [...actions]
    .filter((a) => a && (a.text || a.actionCode))
    .sort((a, b) => String(a.actionDate ?? "").localeCompare(String(b.actionDate ?? "")));

  const j: Journey = {
    stage: "introduced",
    originChamber: originChamberFor(type),
    introduced: null,
    committee: null,
    reported: null,
    passedHouse: null,
    passedSenate: null,
    toPresident: null,
    law: null,
    vetoed: null,
    failed: null,
  };

  const first = (key: keyof Journey, a: ActionLike) => {
    if (!j[key]) (j as any)[key] = { date: a.actionDate ?? null, text: a.text ?? "" };
  };

  for (const a of sorted) {
    const t = a.text ?? "";
    const code = String(a.actionCode ?? "");
    const kind = (a.type ?? "").toLowerCase();
    if (!j.introduced && (kind === "introreferral" || /introduced in/i.test(t) || code === "1000" || code.startsWith("Intro"))) first("introduced", a);
    if (RX.law.test(t) || CODE.law.has(code) || kind === "becamelaw") first("law", a);
    if (RX.veto.test(t) || CODE.veto.has(code) || kind === "veto") {
      if (!/overrid/i.test(t)) first("vetoed", a);
    }
    if (RX.president.test(t) || CODE.president.has(code)) first("toPresident", a);
    if (RX.failed.test(t) || CODE.failedHouse.has(code) || CODE.failedSenate.has(code)) first("failed", a);
    if (RX.passedHouse.test(t) || CODE.passedHouse.has(code)) first("passedHouse", a);
    if (RX.passedSenate.test(t) || CODE.passedSenate.has(code)) first("passedSenate", a);
    if (RX.reported.test(t) || CODE.reported.has(code) || kind === "calendars" || kind === "discharge") first("reported", a);
    if (RX.committee.test(t) || kind === "committee" || kind === "introreferral") first("committee", a);
  }
  if (!j.introduced && sorted[0]) j.introduced = { date: sorted[0].actionDate ?? null, text: sorted[0].text ?? "" };

  const passedBoth = !!(j.passedHouse && j.passedSenate);
  let stage = "introduced";
  if (j.committee) stage = "committee";
  if (j.reported) stage = "reported";
  if (j.passedHouse || j.passedSenate) {
    if (SIMPLE_RES.has(type)) stage = "agreed";
    else if (passedBoth) stage = CONCURRENT_RES.has(type) ? "agreed" : "passed_both";
    else stage = j.passedHouse ? "passed_house" : "passed_senate";
  }
  // A failed floor vote only ends the bill if nothing later revived it.
  if (j.failed && !passedBoth && stageRank(stage) < 3) stage = "failed";
  if (j.toPresident) stage = "to_president";
  if (j.vetoed && !j.law) stage = "vetoed";
  if (j.law) stage = "enacted";
  j.stage = stage;
  return j;
}

export function stageFromActions(actions: ActionLike[], billType: string): string {
  return journeyFromActions(actions, billType).stage;
}

// The six stations drawn on a bill's route line. Chamber order follows the
// bill's origin, so a Senate bill reads Senate -> House.
export type Station = { key: string; label: string; state: "done" | "current" | "todo" | "stopped" };

export function routeStations(stage: string, billType: string): Station[] {
  const origin = originChamberFor(billType);
  const other = origin === "House" ? "Senate" : "House";
  const type = billType.toLowerCase();
  const isSimple = SIMPLE_RES.has(type);
  const isConcurrent = CONCURRENT_RES.has(type);

  const labels = isSimple
    ? ["Introduced", "Committee", origin, "Agreed to"]
    : isConcurrent
      ? ["Introduced", "Committee", origin, other, "Agreed to"]
      : ["Introduced", "Committee", origin, other, "President", "Law"];

  // How many stations are complete for this stage.
  let reached: number;
  switch (stage) {
    case "introduced": reached = 1; break;
    case "committee": reached = 2; break;
    case "reported": reached = 2; break;
    case "passed_house":
    case "passed_senate": reached = 3; break;
    case "passed_both": reached = 4; break;
    case "to_president": reached = 5; break;
    case "enacted":
    case "agreed": reached = labels.length; break;
    case "vetoed": reached = 5; break;
    case "failed": reached = 2; break;
    default: reached = 1;
  }
  reached = Math.min(reached, labels.length);
  const stopped = stage === "vetoed" || stage === "failed";
  const finished = stage === "enacted" || stage === "agreed";

  return labels.map((label, i) => {
    let state: Station["state"] = "todo";
    if (i < reached - 1) state = "done";
    else if (i === reached - 1) state = finished ? "done" : stopped ? "stopped" : "current";
    return { key: `${i}`, label, state };
  });
}

/** Stages that mean a bill has cleared at least one full chamber. */
export const ADVANCED_STAGES = new Set(["passed_house", "passed_senate", "passed_both", "to_president", "enacted", "agreed"]);

/** Days without any congressional action before a bill counts as stalled / gone quiet. Used everywhere. */
export const QUIET_DAYS = 90;
