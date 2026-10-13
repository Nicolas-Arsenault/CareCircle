// A small in-memory feed of what the backend is doing, shown on the dashboard's
// "Behind the scenes" card: Lambda invocations, scheduled runs and alerts.

export interface ActivityEntry {
  at: string;
  source: string;
  message: string;
}

const MAX = 100;
const entries: ActivityEntry[] = [];

export function record(source: string, message: string): void {
  entries.push({ at: new Date().toISOString(), source, message });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}

export function recentActivity(): ActivityEntry[] {
  return entries.slice().reverse();
}
