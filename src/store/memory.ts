import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Alert, CareEvent, Reminder } from "../types.js";
import type { Store } from "./store.js";

interface Snapshot {
  events: CareEvent[];
  reminders: Reminder[];
  alerts: Alert[];
}

/** Keeps everything in process memory. Good for tests and quick demos. */
export class MemoryStore implements Store {
  protected data: Snapshot = { events: [], reminders: [], alerts: [] };

  protected changed(): void {}

  async addEvent(event: CareEvent): Promise<void> {
    this.data.events.push(event);
    this.data.events.sort((a, b) => a.at.localeCompare(b.at));
    this.changed();
  }

  async listEvents(circleId: string, from: string, to: string): Promise<CareEvent[]> {
    return this.data.events.filter((e) => e.circleId === circleId && e.at >= from && e.at < to);
  }

  async addReminder(reminder: Reminder): Promise<void> {
    this.data.reminders.push(reminder);
    this.changed();
  }

  async listReminders(circleId: string): Promise<Reminder[]> {
    return this.data.reminders.filter((r) => r.circleId === circleId);
  }

  async deleteReminder(circleId: string, id: string): Promise<boolean> {
    const before = this.data.reminders.length;
    this.data.reminders = this.data.reminders.filter((r) => !(r.circleId === circleId && r.id === id));
    const removed = this.data.reminders.length < before;
    if (removed) this.changed();
    return removed;
  }

  async getAlert(circleId: string, key: string): Promise<Alert | undefined> {
    return this.data.alerts.find((a) => a.circleId === circleId && a.key === key);
  }

  async putAlert(alert: Alert): Promise<void> {
    this.data.alerts.push(alert);
    this.changed();
  }

  async listAlerts(circleId: string, since: string): Promise<Alert[]> {
    return this.data.alerts.filter((a) => a.circleId === circleId && a.sentAt >= since);
  }
}

/** Memory store that is saved to a JSON file after every write. The default for local use. */
export class FileStore extends MemoryStore {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) {
      this.data = { events: [], reminders: [], alerts: [], ...JSON.parse(readFileSync(path, "utf8")) };
    }
  }

  protected override changed(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}
