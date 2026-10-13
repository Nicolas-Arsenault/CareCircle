// Small time-zone helpers built on Intl, so we avoid a date library.

function parts(date: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** "YYYY-MM-DD" in the given zone. */
export function localDate(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:MM" (24h) in the given zone. */
export function localTime(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.hour}:${p.minute}`;
}

export function weekday(date: Date, timeZone: string): string {
  return parts(date, timeZone).weekday;
}

/** Minutes since local midnight for an "HH:MM" string. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Offset of `timeZone` from UTC at `date`, in minutes. */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** The instant at which it is `hhmm` on local day `ymd` in `timeZone`. */
export function zonedInstant(ymd: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const first = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
  // Re-check once in case the guess straddled a DST change.
  return new Date(guess.getTime() - offsetMinutes(first, timeZone) * 60000);
}

/** Adds whole days to a "YYYY-MM-DD" string. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** "9:05 AM" style for speech. */
export function spokenTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
