import { CareService } from "../src/care.js";
import { MemoryStore } from "../src/store/memory.js";
import { TemplateSummarizer } from "../src/ai/summarizer.js";
import type { Notifier } from "../src/notify/notifier.js";
import { zonedInstant } from "../src/time.js";

export const TZ = "America/Toronto";

export class RecordingNotifier implements Notifier {
  sent: { subject: string; message: string }[] = [];
  async send(subject: string, message: string): Promise<void> {
    this.sent.push({ subject, message });
  }
}

/** A CareService on an in-memory store with a clock the test controls. */
export function makeCare(start = "2026-10-13T07:00") {
  const clock = { now: zonedInstant(start.slice(0, 10), start.slice(11), TZ) };
  const notifier = new RecordingNotifier();
  const store = new MemoryStore();
  const care = new CareService({
    config: { circleId: "test", parentName: "Mom", timeZone: TZ, checkinDeadline: "10:00", doseGraceMinutes: 60 },
    store,
    summarizer: new TemplateSummarizer(),
    notifier,
    now: () => clock.now,
  });
  const setTime = (hhmm: string, ymd = start.slice(0, 10)) => {
    clock.now = zonedInstant(ymd, hhmm, TZ);
  };
  return { care, notifier, store, clock, setTime };
}
