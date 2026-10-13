import type { CareEvent, Reminder, TodayItem } from "../types.js";
import { localDate, localTime, spokenTime, weekday } from "../time.js";

export interface StatusSnapshot {
  parentName: string;
  timeZone: string;
  now: string;
  today: TodayItem[];
  eventsToday: CareEvent[];
  upcoming: Reminder[];
}

export interface WeeklySnapshot {
  parentName: string;
  timeZone: string;
  from: string;
  to: string;
  events: CareEvent[];
  /** Per-day count of scheduled doses and how many were confirmed. */
  doses: { date: string; scheduled: number; taken: number }[];
  missedCheckinDays: string[];
}

/** Turns care data into short, natural sentences for voice and for the family page. */
export interface Summarizer {
  status(s: StatusSnapshot): Promise<string>;
  weekly(s: WeeklySnapshot): Promise<string>;
}

const MOOD_WORDS = ["", "very low", "low", "okay", "good", "great"];

export function moodWord(mood: number | undefined): string {
  return mood ? MOOD_WORDS[Math.max(1, Math.min(5, mood))] : "unknown";
}

/** "2026-10-12" to "Monday, Oct 12". */
function dayName(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Deterministic summaries with no AI call. Used offline and as the Bedrock fallback. */
export class TemplateSummarizer implements Summarizer {
  async status(s: StatusSnapshot): Promise<string> {
    const name = s.parentName;
    const sentences: string[] = [];
    const meds = s.today.filter((t) => t.reminder.kind === "medication");
    const nowTime = localTime(new Date(s.now), s.timeZone);
    const due = meds.filter((t) => t.time <= nowTime);
    const taken = meds.filter((t) => t.done);
    const overdue = due.filter((t) => !t.done);

    const first = s.eventsToday[0];
    if (first) {
      sentences.push(`${name} first checked in at ${spokenTime(localTime(new Date(first.at), s.timeZone))}.`);
    } else {
      sentences.push(`${name} hasn't checked in yet today.`);
    }

    if (meds.length > 0) {
      let line = `${name} has taken ${taken.length} of ${meds.length} medications today`;
      if (overdue.length > 0) line += `, and ${list(overdue.map((t) => t.reminder.title))} ${overdue.length === 1 ? "is" : "are"} overdue`;
      sentences.push(`${line}.`);
    }

    const moods = s.eventsToday.filter((e) => e.kind === "mood");
    const lastMood = moods[moods.length - 1];
    if (lastMood) {
      sentences.push(`Mood is ${moodWord(lastMood.mood)}: "${lastMood.text}".`);
    }

    const meals = s.eventsToday.filter((e) => e.kind === "meal");
    if (meals.length > 0) sentences.push(`${meals.length === 1 ? "One meal" : `${meals.length} meals`} logged.`);

    const next = s.upcoming[0];
    if (next?.dueAt) {
      const at = new Date(next.dueAt);
      const day = localDate(at, s.timeZone) === localDate(new Date(s.now), s.timeZone) ? "today" : weekday(at, s.timeZone);
      sentences.push(`Coming up: ${next.title} ${day} at ${spokenTime(localTime(at, s.timeZone))}.`);
    }
    return sentences.join(" ");
  }

  async weekly(s: WeeklySnapshot): Promise<string> {
    const scheduled = s.doses.reduce((n, d) => n + d.scheduled, 0);
    const taken = s.doses.reduce((n, d) => n + d.taken, 0);
    const moods = s.events.filter((e) => e.kind === "mood" && e.mood);
    const avg = moods.length ? moods.reduce((n, e) => n + (e.mood ?? 0), 0) / moods.length : 0;
    const lowDays = [...new Set(moods.filter((e) => (e.mood ?? 5) <= 2).map((e) => weekday(new Date(e.at), s.timeZone)))];
    const notes = s.events.filter((e) => e.kind === "note" || (e.kind === "mood" && (e.mood ?? 5) <= 2));

    const lines = [
      `Weekly care summary for ${s.parentName} (${s.from} to ${s.to})`,
      "",
      `Medication: ${taken} of ${scheduled} scheduled doses confirmed${scheduled ? ` (${Math.round((taken / scheduled) * 100)}%)` : ""}.`,
      `Check-ins: ${s.missedCheckinDays.length === 0 ? "a check-in every day" : `no morning check-in on ${list(s.missedCheckinDays.map(dayName))}`}.`,
      `Mood: ${moods.length ? `average ${avg.toFixed(1)} out of 5 across ${moods.length} entries` : "not logged"}${lowDays.length ? `, lower on ${list(lowDays)}` : ""}.`,
      `Meals logged: ${s.events.filter((e) => e.kind === "meal").length}.`,
    ];
    if (notes.length) {
      lines.push("", "Worth mentioning to the doctor:");
      for (const n of notes.slice(-6)) lines.push(`- ${weekday(new Date(n.at), s.timeZone)}: ${n.text}`);
    }
    lines.push("", "This summary only reflects what was logged. It is not medical advice.");
    return lines.join("\n");
  }
}
