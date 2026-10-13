import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { Store } from "./store/store.js";
import type { Summarizer, StatusSnapshot, WeeklySnapshot } from "./ai/summarizer.js";
import type { Notifier } from "./notify/notifier.js";
import type { Alert, CareEvent, EventKind, Miss, Reminder, ReminderKind, TodayItem } from "./types.js";
import { addDays, localDate, localTime, minutesOf, zonedInstant } from "./time.js";

export interface CareDeps {
  config: Pick<
    Config,
    "circleId" | "parentName" | "timeZone" | "checkinDeadline" | "doseGraceMinutes"
  >;
  store: Store;
  summarizer: Summarizer;
  notifier: Notifier;
  /** Injected so tests can control time. */
  now?: () => Date;
}

export interface LogInput {
  kind: EventKind;
  text: string;
  by?: string;
  medication?: string;
  mood?: number;
}

export interface ReminderInput {
  kind: ReminderKind;
  title: string;
  /** Local "HH:MM" for something that repeats every day. */
  dailyTime?: string;
  /** Local "YYYY-MM-DD" and "HH:MM" for a one-time reminder. */
  date?: string;
  time?: string;
  by?: string;
}

/** A generic "I took my pills" covers doses scheduled up to this long after it was said. */
const GENERIC_DOSE_WINDOW_MIN = 120;

/** All CareCircle behaviour. The MCP server, web API and Lambdas are thin layers over this. */
export class CareService {
  private readonly now: () => Date;

  constructor(private readonly deps: CareDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get parentName(): string {
    return this.deps.config.parentName;
  }

  private get circleId(): string {
    return this.deps.config.circleId;
  }

  private get tz(): string {
    return this.deps.config.timeZone;
  }

  /** Start and end instants (ISO) of a local calendar day. */
  private dayRange(ymd: string): [string, string] {
    return [
      zonedInstant(ymd, "00:00", this.tz).toISOString(),
      zonedInstant(addDays(ymd, 1), "00:00", this.tz).toISOString(),
    ];
  }

  async logEvent(input: LogInput): Promise<CareEvent> {
    const event: CareEvent = {
      id: randomUUID(),
      circleId: this.circleId,
      kind: input.kind,
      text: input.text.trim(),
      at: this.now().toISOString(),
      by: input.by?.trim() || this.parentName,
      ...(input.medication ? { medication: input.medication.trim() } : {}),
      ...(input.mood ? { mood: Math.max(1, Math.min(5, Math.round(input.mood))) } : {}),
    };
    await this.deps.store.addEvent(event);
    return event;
  }

  async addReminder(input: ReminderInput): Promise<Reminder> {
    if (!input.dailyTime && !(input.date && input.time)) {
      throw new Error("A reminder needs either dailyTime, or both date and time.");
    }
    for (const t of [input.dailyTime, input.time]) {
      if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`Time must be HH:MM (24h), got "${t}".`);
    }
    if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new Error(`Date must be YYYY-MM-DD, got "${input.date}".`);
    }
    const reminder: Reminder = {
      id: randomUUID(),
      circleId: this.circleId,
      kind: input.kind,
      title: input.title.trim(),
      ...(input.dailyTime
        ? { dailyTime: input.dailyTime }
        : { dueAt: zonedInstant(input.date!, input.time!, this.tz).toISOString() }),
      createdBy: input.by?.trim() || this.parentName,
      createdAt: this.now().toISOString(),
    };
    await this.deps.store.addReminder(reminder);
    return reminder;
  }

  async removeReminder(id: string): Promise<boolean> {
    return this.deps.store.deleteReminder(this.circleId, id);
  }

  /** Checklist for one local day: what was due and whether it was done. */
  private itemsForDay(ymd: string, reminders: Reminder[], events: CareEvent[]): TodayItem[] {
    const items: TodayItem[] = [];
    for (const r of reminders) {
      if (r.dailyTime) {
        if (localDate(new Date(r.createdAt), this.tz) <= ymd) items.push({ reminder: r, time: r.dailyTime, done: false });
      } else if (r.dueAt && localDate(new Date(r.dueAt), this.tz) === ymd) {
        items.push({ reminder: r, time: localTime(new Date(r.dueAt), this.tz), done: false });
      }
    }
    items.sort((a, b) => a.time.localeCompare(b.time));

    const meds = items.filter((i) => i.reminder.kind === "medication");
    const doses = events.filter((e) => e.kind === "medication");
    // Named doses first ("took my metformin"), then generic ones ("took my pills").
    for (const e of doses.filter((d) => d.medication)) {
      const name = e.medication!.toLowerCase();
      const match = meds.find((m) => {
        const title = m.reminder.title.toLowerCase();
        return !m.done && (title.includes(name) || name.includes(title));
      });
      if (match) Object.assign(match, { done: true, doneAt: e.at });
    }
    for (const e of doses.filter((d) => !d.medication)) {
      const said = minutesOf(localTime(new Date(e.at), this.tz));
      for (const m of meds) {
        if (!m.done && minutesOf(m.time) <= said + GENERIC_DOSE_WINDOW_MIN) {
          Object.assign(m, { done: true, doneAt: e.at });
        }
      }
    }
    return items;
  }

  async listToday(): Promise<{ date: string; items: TodayItem[]; events: CareEvent[] }> {
    const date = localDate(this.now(), this.tz);
    const [from, to] = this.dayRange(date);
    const [reminders, events] = await Promise.all([
      this.deps.store.listReminders(this.circleId),
      this.deps.store.listEvents(this.circleId, from, to),
    ]);
    return { date, items: this.itemsForDay(date, reminders, events), events };
  }

  async upcoming(days = 14): Promise<Reminder[]> {
    const now = this.now();
    const until = new Date(now.getTime() + days * 86_400_000).toISOString();
    const reminders = await this.deps.store.listReminders(this.circleId);
    return reminders
      .filter((r) => r.dueAt && r.dueAt >= now.toISOString() && r.dueAt < until)
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  }

  async statusSnapshot(): Promise<StatusSnapshot> {
    const [today, upcoming] = await Promise.all([this.listToday(), this.upcoming()]);
    return {
      parentName: this.parentName,
      timeZone: this.tz,
      now: this.now().toISOString(),
      today: today.items,
      eventsToday: today.events,
      upcoming,
    };
  }

  async getStatus(): Promise<{ summary: string; snapshot: StatusSnapshot }> {
    const snapshot = await this.statusSnapshot();
    return { summary: await this.deps.summarizer.status(snapshot), snapshot };
  }

  async getTimeline(days = 7): Promise<{ events: CareEvent[]; alerts: Alert[] }> {
    const to = this.now();
    const from = new Date(to.getTime() - days * 86_400_000).toISOString();
    const [events, alerts] = await Promise.all([
      this.deps.store.listEvents(this.circleId, from, new Date(to.getTime() + 1).toISOString()),
      this.deps.store.listAlerts(this.circleId, from),
    ]);
    return { events, alerts };
  }

  /** What should have happened by now today but didn't. */
  async findMissed(): Promise<Miss[]> {
    const now = this.now();
    const nowMin = minutesOf(localTime(now, this.tz));
    const { date, items, events } = await this.listToday();
    const misses: Miss[] = [];
    const name = this.parentName;

    if (events.length === 0 && nowMin >= minutesOf(this.deps.config.checkinDeadline)) {
      misses.push({
        key: `${date}:checkin`,
        message: `${name} hasn't checked in yet today (expected by ${this.deps.config.checkinDeadline}).`,
      });
    }
    for (const item of items) {
      if (item.reminder.kind !== "medication" || item.done) continue;
      if (nowMin >= minutesOf(item.time) + this.deps.config.doseGraceMinutes) {
        misses.push({
          key: `${date}:dose:${item.reminder.id}`,
          message: `${name}'s ${item.time} dose of ${item.reminder.title} hasn't been confirmed.`,
        });
      }
    }
    return misses;
  }

  /** Alerts the family about new misses. Safe to run every few minutes: each miss alerts once. */
  async runAlertCheck(): Promise<{ misses: Miss[]; sent: Alert[] }> {
    const misses = await this.findMissed();
    const sent: Alert[] = [];
    for (const miss of misses) {
      if (await this.deps.store.getAlert(this.circleId, miss.key)) continue;
      await this.deps.notifier.send(`CareCircle: check on ${this.parentName}`, miss.message);
      const alert: Alert = { circleId: this.circleId, key: miss.key, message: miss.message, sentAt: this.now().toISOString() };
      await this.deps.store.putAlert(alert);
      sent.push(alert);
    }
    return { misses, sent };
  }

  async notifyFamily(message: string, by?: string): Promise<Alert> {
    const from = by?.trim() || this.parentName;
    await this.deps.notifier.send(`CareCircle: message from ${from}`, message);
    const at = this.now().toISOString();
    const alert: Alert = { circleId: this.circleId, key: `message:${at}`, message: `${from}: ${message}`, sentAt: at };
    await this.deps.store.putAlert(alert);
    return alert;
  }

  async weeklySnapshot(): Promise<WeeklySnapshot> {
    const today = localDate(this.now(), this.tz);
    const firstDay = addDays(today, -6);
    const [from] = this.dayRange(firstDay);
    const [, to] = this.dayRange(today);
    const [events, reminders] = await Promise.all([
      this.deps.store.listEvents(this.circleId, from, to),
      this.deps.store.listReminders(this.circleId),
    ]);
    const nowMin = minutesOf(localTime(this.now(), this.tz));
    const deadline = minutesOf(this.deps.config.checkinDeadline);
    const doses: WeeklySnapshot["doses"] = [];
    const missedCheckinDays: string[] = [];

    for (let i = 0; i < 7; i++) {
      const day = addDays(firstDay, i);
      const isToday = day === today;
      const dayEvents = events.filter((e) => localDate(new Date(e.at), this.tz) === day);
      const meds = this.itemsForDay(day, reminders, dayEvents).filter(
        (m) => m.reminder.kind === "medication" && (!isToday || minutesOf(m.time) <= nowMin),
      );
      doses.push({ date: day, scheduled: meds.length, taken: meds.filter((m) => m.done).length });
      const checkedIn = dayEvents.some((e) => minutesOf(localTime(new Date(e.at), this.tz)) < deadline);
      if (!checkedIn && (!isToday || nowMin >= deadline)) missedCheckinDays.push(day);
    }
    return { parentName: this.parentName, timeZone: this.tz, from: firstDay, to: today, events, doses, missedCheckinDays };
  }

  async weeklySummary(): Promise<{ summary: string; snapshot: WeeklySnapshot }> {
    const snapshot = await this.weeklySnapshot();
    return { summary: await this.deps.summarizer.weekly(snapshot), snapshot };
  }
}
