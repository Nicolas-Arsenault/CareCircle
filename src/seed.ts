// Fills the store with a believable week of history for demos: `npm run seed`.
// With the default file store it starts from a clean data file.
import { rmSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createStore } from "./app.js";
import { CareService } from "./care.js";
import { TemplateSummarizer } from "./ai/summarizer.js";
import { ConsoleNotifier } from "./notify/notifier.js";
import { addDays, localDate, zonedInstant } from "./time.js";
import type { EventKind } from "./types.js";

const config = loadConfig();
if (config.store === "file") rmSync(config.dataFile, { force: true });
const store = createStore(config);
let clock = new Date();
const care = new CareService({
  config,
  store,
  summarizer: new TemplateSummarizer(),
  notifier: new ConsoleNotifier(),
  now: () => clock,
});
const tz = config.timeZone;
const today = localDate(new Date(), tz);
const at = (day: string, hhmm: string) => (clock = zonedInstant(day, hhmm, tz));
const log = async (day: string, hhmm: string, kind: EventKind, text: string, extra: { medication?: string; mood?: number; by?: string } = {}) => {
  at(day, hhmm);
  await care.logEvent({ kind, text, ...extra });
};

const start = addDays(today, -6);
at(start, "07:00");
await care.addReminder({ kind: "medication", title: "Metformin", dailyTime: "08:00", by: "Sarah" });
await care.addReminder({ kind: "medication", title: "Lisinopril", dailyTime: "20:00", by: "Sarah" });

// Six past days with a realistic mix: mostly on track, one rough day, one missed evening dose.
const week = ["good", "good", "rough", "good", "missed-evening", "good"];
for (let i = 0; i < week.length; i++) {
  const day = addDays(start, i);
  const kind = week[i];
  await log(day, "07:40", "checkin", "Good morning!");
  await log(day, "08:05", "medication", "I took my metformin", { medication: "Metformin" });
  await log(day, "08:20", "meal", "Had my oatmeal with blueberries");
  if (kind === "rough") {
    await log(day, "11:30", "mood", "I'm feeling dizzy and tired today", { mood: 2 });
    await log(day, "15:10", "note", "Called Mom, she says the dizziness passed after lunch", { by: "Sarah" });
  } else {
    await log(day, "13:00", "mood", "Feeling pretty good, went for a short walk", { mood: 4 });
  }
  await log(day, "12:30", "meal", "Soup and a sandwich for lunch");
  if (kind !== "missed-evening") await log(day, "20:10", "medication", "Took my evening pill");
}

// One upcoming appointment, added by a family member.
at(today, "07:00");
const daysToThursday = (4 - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7 || 7;
await care.addReminder({ kind: "appointment", title: "Dr. Patel checkup", date: addDays(today, daysToThursday), time: "14:00", by: "Sarah" });

console.log(`Seeded ${config.parentName}'s last 6 days into the ${config.store} store. Today is left empty for your demo.`);
