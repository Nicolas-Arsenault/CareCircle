export const EVENT_KINDS = ["medication", "meal", "mood", "checkin", "note"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Something that happened, logged by the parent or a family member. */
export interface CareEvent {
  id: string;
  circleId: string;
  kind: EventKind;
  /** The words as said, e.g. "had my oatmeal and the little white pill". */
  text: string;
  /** ISO timestamp. */
  at: string;
  /** Who logged it, e.g. "Mom" or "Sarah". */
  by: string;
  /** Medication name when kind is "medication" and a specific one was named. */
  medication?: string;
  /** 1 (very low) to 5 (great) when kind is "mood". */
  mood?: number;
}

export const REMINDER_KINDS = ["medication", "appointment", "other"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/**
 * Something that should happen. Either recurring every day at `dailyTime`
 * (local HH:MM, typical for medication) or once at `dueAt` (appointments).
 */
export interface Reminder {
  id: string;
  circleId: string;
  kind: ReminderKind;
  title: string;
  dailyTime?: string;
  dueAt?: string;
  createdBy: string;
  createdAt: string;
}

/** A notification sent to the family, kept so the same miss is only alerted once. */
export interface Alert {
  circleId: string;
  /** Dedupe key, e.g. "2026-10-13:checkin" or "2026-10-13:dose:<reminderId>". */
  key: string;
  message: string;
  sentAt: string;
}

export interface TodayItem {
  reminder: Reminder;
  /** Local HH:MM it is due today. */
  time: string;
  done: boolean;
  doneAt?: string;
}

export interface Miss {
  key: string;
  message: string;
}
