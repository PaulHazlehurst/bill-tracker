import { describe, expect, it } from "vitest";
import { assessJob, type JobRun } from "@/lib/jobLog";

const now = new Date("2026-10-26T11:00:00Z");
const run = (startedHoursAgo: number, finished: boolean, ok: boolean | null, error: string | null = null, job = "poll"): JobRun => ({
  job,
  started_at: new Date(now.getTime() - startedHoursAgo * 3_600_000).toISOString(),
  finished_at: finished ? new Date(now.getTime() - startedHoursAgo * 3_600_000 + 40_000).toISOString() : null,
  ok,
  error,
});

describe("scheduled job watchdog", () => {
  it("is quiet when the last run finished fine, or when there's no history yet", () => {
    expect(assessJob([run(5, true, true)], "poll", now)).toBeNull();
    expect(assessJob([], "poll", now)).toBeNull();
    expect(assessJob([run(5, true, true, null, "notify")], "poll", now)).toBeNull();
  });

  it("notices a run that didn't happen, crashed partway, or failed", () => {
    expect(assessJob([run(30, true, true)], "poll", now)).toMatch(/hasn't run since/);
    expect(assessJob([run(1, false, null)], "poll", now)).toMatch(/never finished/);
    expect(assessJob([run(1, true, false, "couldn't load tracked bills")], "poll", now)).toMatch(/failed .*couldn't load tracked bills/);
  });

  it("gives a run in progress a few minutes before calling it stuck", () => {
    expect(assessJob([run(0.05, false, null)], "poll", now)).toBeNull();
  });

  it("judges the newest run, not older ones", () => {
    expect(assessJob([run(48, true, false, "old failure"), run(5, true, true)], "poll", now)).toBeNull();
  });
});
