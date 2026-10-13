import type { Alert, CareEvent, Reminder } from "../types.js";

/** Persistence for one or more care circles. Implementations: memory, file, DynamoDB. */
export interface Store {
  addEvent(event: CareEvent): Promise<void>;
  /** Events with `from <= at < to` (ISO strings), oldest first. */
  listEvents(circleId: string, from: string, to: string): Promise<CareEvent[]>;
  addReminder(reminder: Reminder): Promise<void>;
  listReminders(circleId: string): Promise<Reminder[]>;
  deleteReminder(circleId: string, id: string): Promise<boolean>;
  getAlert(circleId: string, key: string): Promise<Alert | undefined>;
  putAlert(alert: Alert): Promise<void>;
  listAlerts(circleId: string, since: string): Promise<Alert[]>;
}
